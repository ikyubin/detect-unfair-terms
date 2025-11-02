const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE'; // https://aistudio.google.com/app/apikey 에서 발급받으세요

console.log('🚀 Background.js 로드 완료!');
console.log('📅 시작 시간:', new Date().toLocaleString('ko-KR'));

// ===== RAG: 법률 지식베이스 로드 및 검색 =====
let lawKB = null;
let lawKBLoaded = false;

// 법률 지식베이스 로드
async function loadLawKB() {
  if (lawKBLoaded) return lawKB;
  
  try {
    const response = await fetch(chrome.runtime.getURL('law_kb.json'));
    lawKB = await response.json();
    lawKBLoaded = true;
    console.log(`📚 법률 지식베이스 로드 완료: ${lawKB.length}개 조항`);
    return lawKB;
  } catch (error) {
    console.error('❌ 법률 지식베이스 로드 실패:', error);
    return [];
  }
}

// 약관 텍스트와 법률 조항 간 유사도 계산
function calculateRelevance(termText, lawItem) {
  let score = 0;
  const lowerTerm = termText.toLowerCase();
  const lowerTitle = (lawItem.title || '').toLowerCase();
  const lowerSnippet = (lawItem.snippet || '').toLowerCase();
  const lowerCategory = (lawItem.category || '').toLowerCase();
  
  // 카테고리 매칭 (높은 가중치)
  const termType = detectTermsCategory(termText);
  if (termType === lawItem.category) {
    score += 30;
  }
  
  // 제목 키워드 매칭
  const titleKeywords = lowerTitle.split(/\s+/);
  titleKeywords.forEach(keyword => {
    if (keyword.length > 2 && lowerTerm.includes(keyword)) {
      score += 10;
    }
  });
  
  // 스니펫 키워드 매칭 (핵심 용어들)
  const keyTerms = ['수집', '이용', '제공', '동의', '고지', '목적', '제3자', '개인정보', 
                     '환불', '철회', '해지', '위약금', '책임', '면책', '마케팅', '광고'];
  keyTerms.forEach(term => {
    if (lowerSnippet.includes(term) && lowerTerm.includes(term)) {
      score += 5;
    }
  });
  
  // 법률 조항 ID 매칭 (특정 법률 항목)
  const lawKeywords = [
    { pattern: /개인정보.*수집|수집.*개인정보/i, lawIds: ['P1', 'P2', 'P3'] },
    { pattern: /제3자.*제공|제공.*제3자/i, lawIds: ['P4', 'TP1', 'TP3'] },
    { pattern: /환불|철회|반품/i, lawIds: ['T1', 'T2'] },
    { pattern: /마케팅|광고/i, lawIds: ['M1', 'M2', 'M6'] },
    { pattern: /위약금|손해배상/i, lawIds: ['T4'] }
  ];
  
  lawKeywords.forEach(({ pattern, lawIds }) => {
    if (pattern.test(termText) && lawIds.includes(lawItem.id)) {
      score += 20;
    }
  });
  
  // weight 적용
  return score * (lawItem.weight || 1.0);
}

// 약관 카테고리 자동 감지
function detectTermsCategory(termText) {
  const lower = termText.toLowerCase();
  if (lower.includes('개인정보') || lower.includes('privacy')) return 'privacy';
  if (lower.includes('마케팅') || lower.includes('marketing') || lower.includes('광고')) return 'marketing';
  if (lower.includes('제3자') || lower.includes('third party')) return 'third-party';
  return 'terms';
}

// RAG: 관련 법률 조항 검색 (상위 N개)
async function searchRelevantLaws(termText, limit = 5) {
  if (!lawKBLoaded) {
    await loadLawKB();
  }
  
  if (!lawKB || lawKB.length === 0) {
    console.warn('⚠️ 법률 지식베이스가 비어있음');
    return [];
  }
  
  // 모든 조항에 대해 유사도 계산
  const scoredLaws = lawKB.map(law => ({
    law: law,
    score: calculateRelevance(termText, law)
  }));
  
  // 점수순 정렬 및 상위 N개 선택
  const topLaws = scoredLaws
    .sort((a, b) => b.score - a.score)
    .filter(item => item.score > 0)
    .slice(0, limit)
    .map(item => item.law);
  
  console.log(`🔍 관련 법률 조항 검색: ${topLaws.length}개 발견 (최고 점수: ${scoredLaws[0]?.score || 0})`);
  
  return topLaws;
}

// 메시지 리스너
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 메시지 수신:', request.action, 'from tab:', sender.tab?.id);

  if (request.action === 'analyzeTerms') {
    console.log('🔍 약관 분석 요청 받음:', {
      termsCount: request.terms?.length,
      url: request.url
    });
    analyzeTermsWithGemini(request.terms, request.url, sender.tab.id);
  } else if (request.action === 'updateBadge') {
    console.log('🎯 배지 업데이트 요청:', request.text);
    chrome.action.setBadgeText({ text: request.text, tabId: sender.tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#FFA500' });
  } else {
    console.log('⚠️ 알 수 없는 액션:', request.action);
  }
});

// 약관 텍스트 요약 (토큰 수 줄이기)
function summarizeTerms(terms) {
  return terms.map((term, idx) => {
    let text = term.text;

    // 1. 매우 긴 약관은 핵심 부분만 추출 (첫 3000자)
    if (text.length > 3000) {
      // 중요 섹션 키워드 찾기
      const importantSections = [];
      const keywords = [
        '개인정보', '수집', '제3자', '마케팅', '광고',
        '비용', '요금', '결제', '환불', '해지',
        '책임', '면책', '손해배상', '위험', '주의'
      ];

      // 키워드가 포함된 문단 추출
      const paragraphs = text.split(/\n\n+/);
      paragraphs.forEach(para => {
        if (keywords.some(kw => para.includes(kw)) && para.length > 50) {
          importantSections.push(para);
        }
      });

      // 중요 섹션이 있으면 그것만, 없으면 첫 3000자
      if (importantSections.length > 0) {
        text = importantSections.join('\n\n');
        console.log(`📝 약관 ${idx + 1}: 중요 섹션 ${importantSections.length}개 추출`);
      } else {
        text = text.substring(0, 3000) + '... (이하 생략)';
        console.log(`📝 약관 ${idx + 1}: 3000자로 축약`);
      }
    }

    // 2. 중복 공백/줄바꿈 제거
    text = text.replace(/\n{3,}/g, '\n\n').replace(/\s{2,}/g, ' ');

    return {
      index: idx + 1,
      type: term.features?.type || 'unknown',
      isRequired: term.isRequired,
      text: text
    };
  });
}

// 제미나이 API로 약관 분석
async function analyzeTermsWithGemini(terms, url, tabId) {
  try {
    console.log('🔄 Gemini API 분석 시작...', { termsCount: terms.length, url });
    const startTime = performance.now();

    // ===== RAG: 법률 지식베이스 로드 =====
    await loadLawKB();

    // ===== 최적화 1: 약관 텍스트 요약 =====
    const summarized = summarizeTerms(terms);
    const totalLength = summarized.reduce((sum, t) => sum + t.text.length, 0);
    console.log(`📊 텍스트 크기: ${totalLength.toLocaleString()}자`);

    // ===== RAG: 각 약관에 대한 관련 법률 조항 검색 및 수집 =====
    const allRelevantLaws = new Map(); // 중복 제거를 위해 Map 사용
    
    for (const term of summarized) {
      const relevantLaws = await searchRelevantLaws(term.text, 5);
      relevantLaws.forEach(law => {
        allRelevantLaws.set(law.id, law); // ID를 키로 사용하여 중복 제거
      });
    }
    
    const uniqueLaws = Array.from(allRelevantLaws.values());
    console.log(`📚 총 ${uniqueLaws.length}개의 고유 법률 조항 수집됨`);

    // ===== 법률 조항을 프롬프트 형식으로 포맷팅 =====
    const lawsContext = uniqueLaws.map(law => 
      `[${law.id}] ${law.title}\n법률: ${law.law} ${law.article}\n내용: ${law.snippet}`
    ).join('\n\n');

    // ===== 최적화 2: 체크박스별 개별 분석 프롬프트 (RAG 컨텍스트 포함) =====
    const termsText = summarized.map(t =>
      `[${t.index}. ${t.type}${t.isRequired ? ' 필수' : ''}]\n${t.text}`
    ).join('\n\n---\n\n');

    const prompt = `다음 약관들을 분석하여 유효한 JSON 배열로만 답변하세요. 설명이나 마크다운 없이 순수 JSON만 출력하세요.

약관: ${termsText}

관련 법률 조항 (판단 기준): ${lawsContext || '관련 법률 조항 없음'}

분석 지침: 위의 법률 조항을 기준으로 각 약관이 법적 요건을 충족하는지, 부당한 조항이 포함되어 있는지 판단하세요.

출력 형식 (각 약관마다):
[
  {
    "index": 1,
    "type": "privacy",
    "title": "개인정보 처리방침",
    "isRequired": true,
    "risks": ["위험요소1", "위험요소2"],
    "dataCollection": "수집 정보 요약",
    "keyPoints": ["핵심1", "핵심2"],
    "recommendation": "accept",
    "safetyScore": 7,
    "reason": "권장 이유"
  }
]

recommendation: accept(안전), caution(주의), reject(비권장)

중요: 반드시 유효한 JSON만 출력하세요. 마크다운이나 설명 추가 금지.`;

    console.log(`📏 프롬프트 길이: ${prompt.length.toLocaleString()}자`);

    // ===== 최적화 3: Gemini Flash 모델 + 성능 파라미터 =====
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`;

    const requestBody = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.3,           // 낮은 temperature = 더 빠르고 일관된 응답
        maxOutputTokens: 2048,      // JSON 완전 생성을 위해 충분한 토큰 제공
        topP: 0.8,
        topK: 20
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_NONE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          threshold: "BLOCK_NONE"
        }
      ]
    };

    console.log('⚡ API 호출 시작...');
    const fetchStartTime = performance.now();

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const fetchEndTime = performance.now();
    console.log(`⏱️ API 응답 시간: ${(fetchEndTime - fetchStartTime).toFixed(0)}ms`);

    // HTTP 응답 확인
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API 오류:', response.status, errorText);
      throw new Error(`API 오류: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('📦 API 응답 받음');

    // 응답 구조 검증
    if (!data.candidates || data.candidates.length === 0) {
      console.error('❌ 응답에 candidates가 없음:', data);
      throw new Error('API 응답에 분석 결과가 없습니다.');
    }

    if (!data.candidates[0].content) {
      console.error('❌ 응답에 content가 없음:', data.candidates[0]);
      throw new Error('API 응답 형식이 올바르지 않습니다.');
    }

    if (!data.candidates[0].content.parts || data.candidates[0].content.parts.length === 0) {
      console.error('❌ 응답에 parts가 없음:', data.candidates[0].content);
      throw new Error('API 응답에 텍스트가 없습니다.');
    }

    let analysisText = data.candidates[0].content.parts[0].text;

    if (!analysisText || analysisText.trim() === '') {
      console.error('❌ 분석 결과가 비어있음');
      throw new Error('분석 결과가 비어있습니다.');
    }

    console.log('📝 원본 응답 길이:', analysisText.length, '첫 200자:', analysisText.substring(0, 200));

    // JSON 파싱 시도
    let parsedAnalysis = null;
    try {
      let jsonText = analysisText.trim();

      // 마크다운 코드 블록 제거 (문자열 인덱스 방식으로 확실하게 제거)
      if (jsonText.startsWith('```')) {
        console.log('📌 마크다운 코드 블록 감지, 제거 중...');
        // 첫 번째 줄 제거 (```json 또는 ```)
        const firstNewline = jsonText.indexOf('\n');
        if (firstNewline !== -1) {
          jsonText = jsonText.substring(firstNewline + 1);
        }

        // 마지막 줄 제거 (```)
        const lastBackticks = jsonText.lastIndexOf('```');
        if (lastBackticks !== -1) {
          jsonText = jsonText.substring(0, lastBackticks);
        }
      }

      // 앞뒤 공백 제거
      jsonText = jsonText.trim();

      // JSON 배열/객체로 시작하는지 확인
      if (!jsonText.startsWith('[') && !jsonText.startsWith('{')) {
        console.warn('⚠️ JSON이 [ 또는 {로 시작하지 않음. 첫 10자:', jsonText.substring(0, 10));
        // JSON 시작 위치 찾기
        const arrayStart = jsonText.indexOf('[');
        const objectStart = jsonText.indexOf('{');

        if (arrayStart !== -1 || objectStart !== -1) {
          const startPos = arrayStart !== -1 && objectStart !== -1
            ? Math.min(arrayStart, objectStart)
            : (arrayStart !== -1 ? arrayStart : objectStart);

          jsonText = jsonText.substring(startPos);
          console.log('📍 JSON 시작 위치 찾음:', startPos);
        }
      }

      console.log('🔍 최종 JSON 텍스트 길이:', jsonText.length, '첫 200자:', jsonText.substring(0, 200));

      // JSON 파싱
      parsedAnalysis = JSON.parse(jsonText);
      console.log('✅ JSON 파싱 성공! 항목 수:', Array.isArray(parsedAnalysis) ? parsedAnalysis.length : '객체');
    } catch (parseError) {
      console.error('❌ JSON 파싱 실패:', parseError.message);
      console.error('파싱 실패 위치:', parseError.message.match(/position (\d+)/)?.[1] || '알 수 없음');
      console.error('실패한 텍스트 샘플 (첫 500자):', analysisText.substring(0, 500));
      console.error('실패한 텍스트 샘플 (마지막 200자):', analysisText.substring(Math.max(0, analysisText.length - 200)));
      // JSON 파싱 실패 시 텍스트 그대로 사용
      parsedAnalysis = null;
    }

    const endTime = performance.now();
    const totalTime = endTime - startTime;
    console.log(`✅ 분석 완료 (총 ${totalTime.toFixed(0)}ms)`);
    console.log(`   - API 호출: ${(fetchEndTime - fetchStartTime).toFixed(0)}ms`);
    console.log(`   - 데이터 처리: ${(totalTime - (fetchEndTime - fetchStartTime)).toFixed(0)}ms`);

    // 결과 저장 (JSON 형식 또는 텍스트)
    const result = {
      url: url,
      timestamp: new Date().toISOString(),
      termsCount: terms.length,
      analysis: analysisText,           // 원본 텍스트 (호환성)
      structuredAnalysis: parsedAnalysis, // 파싱된 JSON (새 형식)
      rawTerms: terms,
      processingTime: Math.round(totalTime)
    };

    await chrome.storage.local.set({
      [`analysis_${tabId}`]: result
    });

    console.log('💾 결과 저장 완료');

    // 배지 업데이트
    chrome.action.setBadgeText({ text: '완료', tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

    // 알림 표시 (notifications 권한이 있을 때만)
    try {
      if (chrome.notifications) {
        await chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon48.png',
          title: '약관 분석 완료',
          message: `분석 완료! (${Math.round(totalTime / 1000)}초 소요)`
        });
      }
    } catch (notificationError) {
      // 알림 오류는 무시 (중요하지 않음)
      console.log('알림 표시 실패 (무시됨):', notificationError.message);
    }

    console.log('🎉 분석 프로세스 완료');

    // content.js에 성공 알림
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'analysisComplete',
        success: true
      });
    } catch (msgError) {
      console.log('content.js 메시지 전송 실패 (무시):', msgError.message);
    }

  } catch (error) {
    console.error('❌ 분석 중 오류:', error);
    console.error('오류 스택:', error.stack);

    // 사용자에게 보여줄 오류 메시지 저장
    const errorResult = {
      url: url,
      timestamp: new Date().toISOString(),
      termsCount: terms.length,
      analysis: `분석 중 오류가 발생했습니다.\n\n오류 내용: ${error.message}\n\n약관이 너무 길거나 API 호출에 문제가 있을 수 있습니다.`,
      rawTerms: terms,
      isError: true
    };

    try {
      await chrome.storage.local.set({
        [`analysis_${tabId}`]: errorResult
      });
    } catch (storageError) {
      console.error('❌ 저장 실패:', storageError);
    }

    // 배지 업데이트
    chrome.action.setBadgeText({ text: '오류', tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#F44336' });

    // content.js에 에러 알림
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'analysisComplete',
        success: false,
        error: error.message
      });
    } catch (msgError) {
      console.log('content.js 메시지 전송 실패 (무시):', msgError.message);
    }
  }
}
