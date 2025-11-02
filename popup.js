document.addEventListener('DOMContentLoaded', async () => {
  const loadingDiv = document.getElementById('loading');
  const noDataDiv = document.getElementById('no-data');
  const resultDiv = document.getElementById('result');

  // 현재 탭 정보 가져오기
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // 배지 상태 확인
  let badgeText = '';
  try {
    badgeText = await chrome.action.getBadgeText({ tabId: tab.id });
  } catch (e) {
    console.log('배지 확인 실패:', e);
  }

  console.log('팝업 열림 - 탭:', tab.id, '배지:', badgeText);

  // 저장된 분석 결과 가져오기
  chrome.storage.local.get([`analysis_${tab.id}`], async (result) => {
    const analysis = result[`analysis_${tab.id}`];

    console.log('저장된 분석:', analysis);
    console.log('현재 배지:', badgeText);

    // 약관이 없으면 팝업 닫기
    if (!analysis && !badgeText) {
      window.close();
      return;
    }

    
    // 상태 판단 로직
    if (badgeText === '분석중' || badgeText === '분석 중' || badgeText === 'analyzing') {
      // 분석 중 상태
      showAnalyzing();
    } else if (badgeText === '완료' || badgeText === 'done') {
      // 분석 완료 - 결과 확인
      if (analysis) {
        displayAnalysisResults(analysis);
        resultDiv.style.display = 'block';
        loadingDiv.style.display = 'none';
        noDataDiv.style.display = 'none';
      } else {
        // 배지는 완료인데 저장된 데이터 없음 - 재시도
        console.log('배지는 완료인데 데이터 없음 - 1초 후 재확인');
        setTimeout(() => {
          chrome.storage.local.get([`analysis_${tab.id}`], (retryResult) => {
            const retryAnalysis = retryResult[`analysis_${tab.id}`];
            if (retryAnalysis) {
              displayAnalysisResults(retryAnalysis);
              resultDiv.style.display = 'block';
              loadingDiv.style.display = 'none';
              noDataDiv.style.display = 'none';
            } else {
              showNoData();
            }
          });
        }, 1000);
      }
    } else if (badgeText === '오류' || badgeText === 'error') {
      // 오류 상태
      if (analysis && analysis.isError) {
        displayAnalysisResults(analysis);
        resultDiv.style.display = 'block';
        loadingDiv.style.display = 'none';
        noDataDiv.style.display = 'none';
      } else {
        showError();
      }
    } else if (analysis) {
      // 배지는 없지만 저장된 분석이 있음
      displayAnalysisResults(analysis);
      resultDiv.style.display = 'block';
      loadingDiv.style.display = 'none';
      noDataDiv.style.display = 'none';
    } else {
      // 약관 없음
      showNoData();
    }
  });

  // 원문 보기 버튼
  document.getElementById('view-raw')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.storage.local.get([`analysis_${tab.id}`], (result) => {
      const analysis = result[`analysis_${tab.id}`];
      if (analysis && analysis.rawTerms && analysis.rawTerms.length > 0) {
        // 원문 텍스트를 새 창에서 표시
        const rawText = analysis.rawTerms.map(term => term.text).join('\n\n---\n\n');
        const blob = new Blob([rawText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        chrome.tabs.create({ url: url });
      }
    });
  });

  // 다시 분석 버튼
  document.getElementById('re-analyze')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // content.js에 수동 분석 요청
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'manualAnalyze' });
      window.close();
    } catch (e) {
      // 메시지 전송 실패 시 페이지 새로고침
      await chrome.tabs.reload(tab.id);
      window.close();
    }
  });
});

// 분석 중 상태 표시
function showAnalyzing() {
  const loadingDiv = document.getElementById('loading');
  const noDataDiv = document.getElementById('no-data');
  const resultDiv = document.getElementById('result');

  loadingDiv.style.display = 'block';
  noDataDiv.style.display = 'none';
  resultDiv.style.display = 'none';

  // 로딩 메시지 업데이트
  const loadingText = loadingDiv.querySelector('p');
  if (loadingText) {
    loadingText.textContent = '약관을 분석하고 있습니다...';
  }

  console.log('팝업 상태: 분석 중');
}

// 약관 없음 상태 표시
function showNoData() {
  const loadingDiv = document.getElementById('loading');
  const noDataDiv = document.getElementById('no-data');
  const resultDiv = document.getElementById('result');

  loadingDiv.style.display = 'none';
  noDataDiv.style.display = 'block';
  resultDiv.style.display = 'none';

  console.log('팝업 상태: 약관 없음');
}

// 오류 상태 표시
function showError() {
  const loadingDiv = document.getElementById('loading');
  const noDataDiv = document.getElementById('no-data');
  const resultDiv = document.getElementById('result');

  loadingDiv.style.display = 'none';
  noDataDiv.style.display = 'block';
  resultDiv.style.display = 'none';

  // 오류 메시지로 변경
  const noDataIcon = noDataDiv.querySelector('.icon');
  const noDataText = noDataDiv.querySelector('p');

  if (noDataIcon) noDataIcon.textContent = '❌';
  if (noDataText) noDataText.textContent = '분석 중 오류가 발생했습니다. 다시 시도해주세요.';

  console.log('팝업 상태: 오류');
}

function displayAnalysisResults(analysis) {
  // 기본 정보 표시
  document.getElementById('url').textContent = new URL(analysis.url).hostname;
  document.getElementById('terms-count').textContent = `${analysis.termsCount}개`;
  document.getElementById('timestamp').textContent = formatTimestamp(analysis.timestamp);

  // 구조화된 분석이 있으면 체크박스 UI로 표시
  if (analysis.structuredAnalysis && Array.isArray(analysis.structuredAnalysis)) {
    renderStructuredAnalysis(analysis.structuredAnalysis);
    document.getElementById('structured-analysis').style.display = 'block';
    document.getElementById('text-analysis').style.display = 'none';
  } else {
    // 기존 텍스트 분석 표시 (호환성)
    const analysisDiv = document.getElementById('analysis');
    analysisDiv.innerHTML = formatAnalysis(analysis.analysis);

    // 오류인 경우 스타일 변경
    if (analysis.isError) {
      analysisDiv.style.borderColor = '#f56565';
      analysisDiv.style.background = '#fff5f5';
    }

    document.getElementById('structured-analysis').style.display = 'none';
    document.getElementById('text-analysis').style.display = 'block';
  }

  console.log('팝업 상태: 결과 표시');
}

function renderStructuredAnalysis(terms) {
  const container = document.getElementById('terms-checklist');
  container.innerHTML = '';

  terms.forEach((term, idx) => {
    const card = createTermCard(term, idx);
    container.appendChild(card);
  });
}

function createTermCard(term, idx) {
  const card = document.createElement('div');
  card.className = 'term-card';

  // 추천 상태에 따른 스타일
  const recommendation = term.recommendation || 'caution';
  card.classList.add(`rec-${recommendation}`);

  // 카드 헤더
  const header = document.createElement('div');
  header.className = 'term-header';
  header.innerHTML = `
    <div class="term-title-section">
      <h3 class="term-title">${term.title || `약관 ${term.index}`}</h3>
      <div class="term-badges">
        ${term.isRequired ? '<span class="required-badge">필수</span>' : '<span class="optional-badge">선택</span>'}
        <span class="recommendation-badge ${recommendation}">
          ${getRecommendationText(recommendation)}
        </span>
      </div>
    </div>
    <div class="safety-score-container">
      <div class="safety-score">${term.safetyScore || 'N/A'}</div>
      <div class="safety-label">안전도</div>
    </div>
  `;

  // 이유 섹션
  const reason = document.createElement('div');
  reason.className = 'term-reason';
  reason.innerHTML = `
    <div class="reason-icon">${getRecommendationIcon(recommendation)}</div>
    <div class="reason-text">${term.reason || '분석 정보 없음'}</div>
  `;

  // 상세 정보 (접을 수 있는 섹션)
  const details = document.createElement('div');
  details.className = 'term-details';
  details.style.display = 'none';

  let detailsHTML = '';

  // 위험 요소
  if (term.risks && term.risks.length > 0) {
    detailsHTML += `
      <div class="detail-section">
        <h4>⚠️ 주의사항</h4>
        <ul class="risk-list">
          ${term.risks.map(risk => `<li>${risk}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // 개인정보 수집
  if (term.dataCollection) {
    detailsHTML += `
      <div class="detail-section">
        <h4>📋 수집 정보</h4>
        <p>${term.dataCollection}</p>
      </div>
    `;
  }

  // 핵심 내용
  if (term.keyPoints && term.keyPoints.length > 0) {
    detailsHTML += `
      <div class="detail-section">
        <h4>💡 핵심 내용</h4>
        <ul class="key-points">
          ${term.keyPoints.map(point => `<li>${point}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  details.innerHTML = detailsHTML;

  // 더보기 버튼
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'toggle-details-btn';
  toggleBtn.textContent = '상세 정보 보기';
  toggleBtn.addEventListener('click', () => {
    const isHidden = details.style.display === 'none';
    details.style.display = isHidden ? 'block' : 'none';
    toggleBtn.textContent = isHidden ? '접기' : '상세 정보 보기';
    card.classList.toggle('expanded');
  });

  // 카드 조립
  card.appendChild(header);
  card.appendChild(reason);
  if (detailsHTML) {
    card.appendChild(toggleBtn);
    card.appendChild(details);
  }

  return card;
}

function getRecommendationText(recommendation) {
  const texts = {
    accept: '✓ 권장',
    caution: '⚡ 주의',
    reject: '✗ 비권장'
  };
  return texts[recommendation] || '⚡ 주의';
}

function getRecommendationIcon(recommendation) {
  const icons = {
    accept: '✅',
    caution: '⚠️',
    reject: '❌'
  };
  return icons[recommendation] || '⚠️';
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / 60000);

  if (diffMinutes < 1) return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}시간 전`;

  return date.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatAnalysis(text) {
  if (!text) return '<p>분석 결과가 없습니다.</p>';

  let formatted = text;

  // 섹션 제목 강조 (1. 2. 3. 등으로 시작하는 줄)
  formatted = formatted.replace(/^(\d+\.\s+[^:\n]+):/gm, '<strong style="color: #667eea; font-size: 14px;">$1:</strong>');

  // 글머리 기호 (- 또는 *)
  formatted = formatted.replace(/^[\-\*]\s+(.+)$/gm, '<div style="padding-left: 16px; margin: 6px 0;">• $1</div>');

  // 볼드 텍스트 (**text**)
  formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 위험도 점수 하이라이트 (예: "안전도 점수: 7/10" 또는 "7점")
  formatted = formatted.replace(/(\d+)\/10/g, '<span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2px 8px; border-radius: 6px; font-weight: 600;">$1/10</span>');
  formatted = formatted.replace(/(\d+)점/g, '<span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 2px 8px; border-radius: 6px; font-weight: 600;">$1점</span>');

  // 위험 키워드 하이라이트
  const riskKeywords = ['위험', '주의', '불리', '제한', '금지', '책임 없음', '환불 불가'];
  riskKeywords.forEach(keyword => {
    const regex = new RegExp(`(${keyword})`, 'g');
    formatted = formatted.replace(regex, '<span style="color: #c53030; font-weight: 600;">$1</span>');
  });

  // 긍정 키워드 하이라이트
  const positiveKeywords = ['안전', '보호', '환불', '취소 가능'];
  positiveKeywords.forEach(keyword => {
    const regex = new RegExp(`(${keyword})`, 'g');
    formatted = formatted.replace(regex, '<span style="color: #22543d; font-weight: 600;">$1</span>');
  });

  // 문단 구분
  formatted = formatted.replace(/\n\n+/g, '</p><p style="margin: 16px 0;">');
  formatted = formatted.replace(/\n/g, '<br>');

  // 전체를 p 태그로 감싸기
  formatted = `<p style="margin: 16px 0;">${formatted}</p>`;

  return formatted;
}
