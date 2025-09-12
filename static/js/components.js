;(function(){
  'use strict';

  function el(tag, className, children){
    const e = document.createElement(tag);
    if(className) e.className = className;
    if(children){
      if(Array.isArray(children)) children.forEach(c => c && e.appendChild(c));
      else if(typeof children === 'string') e.textContent = children;
      else e.appendChild(children);
    }
    return e;
  }

  // Dropdown helpers
  window.populateDropdown = function(id, items, selectedValue){
    const root = document.getElementById(id);
    const btn = root.querySelector('.dropdown-toggle');
    const menu = root.querySelector('.dropdown-menu');
    menu.innerHTML = '';
    (items||[]).forEach(it => {
      const li = el('li','', it.label);
      li.tabIndex = 0;
      li.addEventListener('click', ()=>{
        btn.textContent = it.label;
        btn.dataset.value = it.value;
        root.dispatchEvent(new CustomEvent('change', {detail: it.value}));
      });
      li.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ li.click(); }});
      menu.appendChild(li);
      if(selectedValue!==undefined && selectedValue===it.value){ btn.textContent = it.label; btn.dataset.value = it.value; }
    });
  }

  window.setupDropdown = function(id, onChange){
    const root = document.getElementById(id);
    const btn = root.querySelector('.dropdown-toggle');
    const menu = root.querySelector('.dropdown-menu');
    btn.addEventListener('click', ()=> root.classList.toggle('open'));
    document.addEventListener('click', (e)=>{ if(!root.contains(e.target)) root.classList.remove('open'); });
    root.addEventListener('change', (e)=>{ if(onChange) onChange(e.detail); });
  }

  // KPI Cards
  window.renderKpiCards = function(container, items, onClick){
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    (items||[]).forEach(it => {
      const card = el('div','card kpi');
      const title = el('div','kpi-title', it.label);
      const value = el('div','kpi-value', it.value);
      card.appendChild(title);
      card.appendChild(value);
      if(onClick){ card.addEventListener('click', ()=> onClick(it.label)); }
      frag.appendChild(card);
    });
    container.appendChild(frag);
  }

  // Timeline
  window.renderTimeline = function(container, events){
    container.innerHTML = '';
    const months = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    const header = el('div','timeline-header');
    // Add leading label header to align with rows' first column
    const headLabel = el('div','timeline-label head','과정명');
    header.appendChild(headLabel);
    months.forEach(m=> header.appendChild(el('div','timeline-col', `${m}월`)));
    container.appendChild(header);
    const body = el('div','timeline-body');
    (events||[]).forEach(ev => {
      const row = el('div','timeline-row');
      months.forEach((mIdx, i)=>{
        const cell = el('div','timeline-col');
        // basic bar if in range
        const s = ev.start ? new Date(ev.start) : null;
        const e = ev.end ? new Date(ev.end) : null;
        const y = s ? s.getFullYear() : null;
        const inMonth = s && e && (i+1)>= (s.getMonth()+1) && (i+1)<= (e.getMonth()+1);
        if(inMonth){
          const statusKey = (ev.status||'').toString().trim();
          const bar = el('div', `bar status-${statusKey}`);
          bar.title = `${ev.name||''}`;
          cell.appendChild(bar);
        }
        row.appendChild(cell);
      });
      const label = el('div','timeline-label', `${ev.name||''}`);
      row.prepend(label);
      body.appendChild(row);
    });
    container.appendChild(body);
  }

  // Year Calendar
  window.renderYearCalendar = function(container, year){
    container.innerHTML = '';
    const grid = el('div','calendar-grid');
    for(let m=1; m<=12; m++){
      const cell = el('div','calendar-cell');
      cell.appendChild(el('div','calendar-month', `${m}월`));
      grid.appendChild(cell);
    }
    container.appendChild(grid);
  }

  // Program Cards
  window.renderProgramCards = function(container, programs, onClick){
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    (programs||[]).forEach(p => {
      const card = el('div','card program');
      const header = el('div','program-header');
      header.appendChild(el('div','program-title', p['HRD_Net_과정명']||p['과정명']||'무제'));
      header.appendChild(el('span','badge', p['진행상태']||''));
      const meta = el('div','program-meta');
      meta.appendChild(el('span','', `년도: ${p['년도']||''}`));
      meta.appendChild(el('span','', `분기: ${p['분기']||''}`));
      meta.appendChild(el('span','', `팀: ${p['담당팀']||p['팀']||p['과정구분']||''}`));
      card.appendChild(header);
      card.appendChild(meta);
      card.addEventListener('click', ()=> onClick && onClick(p));
      frag.appendChild(card);
    });
    container.appendChild(frag);
  }

  // Currency formatter
  function fmtWon(n){
    const v = Number(n||0);
    return v.toLocaleString('ko-KR');
  }

  // Revenue table
  window.renderRevenueTable = function(container, data){
    container.innerHTML = '';
    const table = el('div','card');
    const header = el('div','rev-row');
    header.appendChild(el('div','rev-col head','과정명'));
    header.appendChild(el('div','rev-col head','회차'));
    header.appendChild(el('div','rev-col head','분기'));
    header.appendChild(el('div','rev-col head right','예상 매출'));
    header.appendChild(el('div','rev-col head right','실 매출'));
    header.appendChild(el('div','rev-col head right','차이'));
    header.appendChild(el('div','rev-col head right','최대 가능'));
    table.appendChild(header);
    (data||[]).forEach(it=>{
      const row = el('div','rev-row');
      row.appendChild(el('div','rev-col', it.program||''));
      row.appendChild(el('div','rev-col', String(it.round||'')));
      row.appendChild(el('div','rev-col', String(it.quarter||'')));
      row.appendChild(el('div','rev-col right', fmtWon(it.expected)));
      row.appendChild(el('div','rev-col right', fmtWon(it.actual)));
      row.appendChild(el('div','rev-col right', fmtWon(it.gap)));
      row.appendChild(el('div','rev-col right', fmtWon(it.max)));
      table.appendChild(row);
    });
    container.appendChild(table);
  }

  // Monthly expected table (per program)
  window.renderMonthlyExpectedTable = function(container, items){
    container.innerHTML = '';
    const table = el('div','card');
    const head = el('div','rev-row');
    head.appendChild(el('div','rev-col head','과정명'));
    head.appendChild(el('div','rev-col head','회차'));
    head.appendChild(el('div','rev-col head right','월 인덱스'));
    head.appendChild(el('div','rev-col head right','예상 매출'));
    table.appendChild(head);
    (items||[]).forEach(it=>{
      const row = el('div','rev-row');
      row.appendChild(el('div','rev-col', it.program||''));
      row.appendChild(el('div','rev-col', it.round||''));
      row.appendChild(el('div','rev-col right', String(it.monthIndex||0)));
      row.appendChild(el('div','rev-col right', Number(it.expected||0).toLocaleString('ko-KR')));
      table.appendChild(row);
    });
    container.appendChild(table);
  }

  // 선택된 과정들의 운영 기간 분석
  function analyzeProgramsPeriod(programsData, selectedPrograms) {
    if (!selectedPrograms || selectedPrograms.length === 0) {
      return null; // 전체 과정 선택 시
    }
    
    let earliestDate = null;
    let latestDate = null;
    let allMonths = new Set();
    
    selectedPrograms.forEach(programName => {
      const programInfo = programsData[programName];
      if (!programInfo) return;
      
      const startDate = new Date(programInfo.start_date);
      const endDate = new Date(programInfo.end_date);
      
      // 전체 기간의 최소/최대 날짜 계산
      if (!earliestDate || startDate < earliestDate) {
        earliestDate = startDate;
      }
      if (!latestDate || endDate > latestDate) {
        latestDate = endDate;
      }
      
      // 해당 과정의 모든 운영 월 수집
      Object.keys(programInfo.monthly_data || {}).forEach(monthKey => {
        const revenue = programInfo.monthly_data[monthKey];
        if (revenue > 0) { // 데이터가 있는 월만 포함
          allMonths.add(monthKey);
        }
      });
    });
    
    // 시간 순으로 정렬된 월 배열 생성
    const sortedMonths = Array.from(allMonths).sort();
    
    return {
      earliestDate,
      latestDate,
      months: sortedMonths
    };
  }

  // 월별 매출 차트 데이터 가공 함수 (동적 기간 지원)
  function processYearlyMonthlyRevenueData(data, targetYear, selectedPrograms = []) {
    const monthlyTotals = data?.monthly_totals || {};
    const programsData = data?.programs_data || {};
    
    // 선택된 과정이 없으면 전체 데이터 반환 (기존 방식)
    if (!selectedPrograms || selectedPrograms.length === 0) {
      const labels = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
      return {
        labels: labels,
        datasets: [{
          label: `${targetYear}년 전체 과정`,
          data: [
            monthlyTotals[1] || 0, monthlyTotals[2] || 0, monthlyTotals[3] || 0, monthlyTotals[4] || 0,
            monthlyTotals[5] || 0, monthlyTotals[6] || 0, monthlyTotals[7] || 0, monthlyTotals[8] || 0,
            monthlyTotals[9] || 0, monthlyTotals[10] || 0, monthlyTotals[11] || 0, monthlyTotals[12] || 0
          ],
          borderColor: 'rgba(59, 130, 246, 1)',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4
        }]
      };
    }
    
    // 선택된 과정들의 운영 기간 분석
    const periodInfo = analyzeProgramsPeriod(programsData, selectedPrograms);
    if (!periodInfo || periodInfo.months.length === 0) {
      return { labels: [], datasets: [] };
    }
    
    // YYYY-MM 형식의 라벨 생성
    const labels = periodInfo.months;
    
    // 색상 팔레트
    const colors = [
      'rgba(59, 130, 246, 1)',    // 파랑
      'rgba(16, 185, 129, 1)',    // 초록
      'rgba(245, 101, 101, 1)',   // 빨강
      'rgba(251, 191, 36, 1)',    // 노랑
      'rgba(139, 92, 246, 1)',    // 보라
      'rgba(236, 72, 153, 1)',    // 핑크
      'rgba(6, 182, 212, 1)',     // 청록
      'rgba(34, 197, 94, 1)',     // 라임
      'rgba(239, 68, 68, 1)',     // 오렌지-빨강
      'rgba(168, 85, 247, 1)'     // 인디고
    ];
    
    // 선택된 과정들에 대한 개별 라인 생성
    const datasets = selectedPrograms.map((programName, index) => {
      const programInfo = programsData[programName];
      if (!programInfo) return null;
      
      const color = colors[index % colors.length];
      const monthlyData = programInfo.monthly_data || {};
      
      // 각 월에 대한 데이터 매핑
      const data = labels.map(monthKey => monthlyData[monthKey] || 0);
      
      return {
        label: programName,
        data: data,
        borderColor: color,
        backgroundColor: color.replace('1)', '0.1)'),
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointBackgroundColor: color,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6
      };
    }).filter(dataset => dataset !== null);
    
    return {
      labels: labels,
      datasets: datasets
    };
  }

  // Chart.js를 사용한 월별 매출 차트 렌더링
  let monthlyRevenueChart = null;
  
  function renderMonthlyRevenueChart(data, year, selectedPrograms = []) {
    const ctx = document.getElementById('monthlyRevenueChart');
    if (!ctx) return;
    
    // 기존 차트 파괴
    if (monthlyRevenueChart) {
      monthlyRevenueChart.destroy();
    }
    
    const chartData = processYearlyMonthlyRevenueData(data, year, selectedPrograms);
    
    monthlyRevenueChart = new Chart(ctx, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: 'var(--text-primary)',
              font: {
                size: 12,
                weight: '500'
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            borderColor: 'rgba(59, 130, 246, 1)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${context.parsed.y.toLocaleString('ko-KR')}원`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            },
            ticks: {
              color: 'var(--text-secondary)',
              font: {
                size: 11
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(148, 163, 184, 0.1)'
            },
            ticks: {
              color: 'var(--text-secondary)',
              font: {
                size: 11
              },
              callback: function(value) {
                return (value / 1000000).toFixed(0) + '백만원';
              }
            }
          }
        },
        elements: {
          point: {
            hoverBackgroundColor: 'rgba(59, 130, 246, 1)'
          }
        }
      }
    });
  }

  // 과정 필터 드롭다운 업데이트
  function updateCourseFilter(programsList) {
    const courseFilter = document.getElementById('courseFilter');
    if (!courseFilter) return;
    
    // 기존 옵션 제거 (첫 번째 "전체 과정" 옵션은 유지)
    while (courseFilter.children.length > 1) {
      courseFilter.removeChild(courseFilter.lastChild);
    }
    
    // 새 과정 옵션 추가
    programsList.forEach(program => {
      const option = document.createElement('option');
      option.value = program;
      option.textContent = program;
      courseFilter.appendChild(option);
    });
  }
  
  // 선택된 과정들 가져오기
  function getSelectedPrograms() {
    const courseFilter = document.getElementById('courseFilter');
    if (!courseFilter) return [];
    
    const selected = Array.from(courseFilter.selectedOptions)
      .map(option => option.value)
      .filter(value => value !== ''); // 빈 값(전체 과정) 제외
    
    return selected;
  }

  // 전역 함수로 노출
  window.renderMonthlyRevenueChart = renderMonthlyRevenueChart;
  window.updateCourseFilter = updateCourseFilter;
  window.getSelectedPrograms = getSelectedPrograms;
})();


