;(function(){
  'use strict';

  class KDTDashboard {
    constructor(){
      this.state = {
        year: '',
        quarter: '',
        category: '',
        status: '',
        trendChart: null,
        revenueChart: null,
        programsCache: []
      };
      window.dashboard = this;
    }

    async init(){
      await this.waitForElements();
      this.bindEvents();
      await this.loadFilterOptions();
      await this.loadPrograms();
      await this.updateTabData();
      this.updateLastUpdated();
    }

    waitForElements(){
      const required = [
        '#dashboard-kpis','#trendChart',
        '#education-kpis','#education-timeline',
        '#business-kpis','#business-table',
        '#programList','#programModal'
      ];
      return new Promise(resolve => {
        const check = ()=>{
          const ok = required.every(sel => document.querySelector(sel));
          if(ok) resolve(); else setTimeout(check, 30);
        };
        check();
      });
    }

    bindEvents(){
      // Sidebar toggle
      const sidebarToggle = document.getElementById('sidebarToggle');
      sidebarToggle.addEventListener('click', ()=>{
        document.getElementById('sidebar').classList.toggle('collapsed');
      });

      // Tabs (기본 내비게이션 + 데이터 관리 섹션)
      document.querySelectorAll('aside nav li, aside .management-section li').forEach(li => {
        li.addEventListener('click', () => {
          // 모든 탭에서 active 클래스 제거
          document.querySelectorAll('aside nav li, aside .management-section li').forEach(x=>x.classList.remove('active'));
          li.classList.add('active');
          const tabId = li.getAttribute('data-tab');
          document.querySelectorAll('.tab-content').forEach(sec=>sec.classList.remove('active'));
          document.getElementById(tabId).classList.add('active');
          this.updateTabData();
        });
      });

      // Dropdowns
      setupDropdown('yearDropdown', (value)=>{this.state.year = value; this.updateFilters();});
      setupDropdown('quarterDropdown', (value)=>{this.state.quarter = value; this.updateFilters();});
      setupDropdown('categoryDropdown', (value)=>{this.state.category = value; this.updateFilters();});
      const statusSelect = document.getElementById('statusSelect');
      statusSelect.addEventListener('change', ()=>{this.state.status = statusSelect.value; this.updateFilters();});

      // Program modal buttons
      document.getElementById('btnAddProgram').addEventListener('click', ()=> this.openProgramModal());
      document.getElementById('modalClose').addEventListener('click', ()=> this.closeProgramModal());
      document.getElementById('btnCancelProgram').addEventListener('click', ()=> this.closeProgramModal());
      document.getElementById('btnSaveProgram').addEventListener('click', ()=> this.saveProgram());
      document.getElementById('btnDeleteProgram').addEventListener('click', ()=> this.deleteProgram());

      // Dashboard control - 새로운 메트릭 버튼들
      const metricBtns = document.querySelectorAll('.metric-btn');
      metricBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          // 모든 버튼에서 active 클래스 제거
          metricBtns.forEach(b => b.classList.remove('active'));
          // 클릭된 버튼에 active 클래스 추가
          btn.classList.add('active');
          // 메트릭 업데이트
          const metric = btn.dataset.metric;
          this.updateTrendChart(metric);
        });
      });

      // Timeline status filter
      const timelineStatusToggle = document.querySelector('.timeline-status-toggle');
      if (timelineStatusToggle) {
        timelineStatusToggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dropdown = timelineStatusToggle.closest('.timeline-status-dropdown');
          this.toggleTimelineDropdown(dropdown);
        });
      }
      
      const timelineStatusMenu = document.querySelector('.timeline-status-menu');
      if (timelineStatusMenu) {
        timelineStatusMenu.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const link = e.target.closest('a');
          if (link && link.dataset.status) {
            const status = link.dataset.status;
            const year = this.state.year || '2025';
            
            // 상태 필터 업데이트
            this.updateTimelineStatusActive(link);
            
            // 타임라인 리로드
            this.loadTimeline(year, status);
            
            // 드롭다운 닫기
            this.closeTimelineDropdowns();
          }
        });
      }
      
      // 타임라인 드롭다운 외부 클릭 이벤트
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.timeline-status-dropdown')) {
          this.closeTimelineDropdowns();
        }
      });

      // Business monthly expected
      const btnMonthly = document.getElementById('btnLoadMonthly');
      if(btnMonthly){
        btnMonthly.addEventListener('click', async ()=>{
          try{
            const y = document.getElementById('monthlyYear').value || (this.state.year || '2025');
            const m = document.getElementById('monthlyMonth').value || '7';
            const q = new URLSearchParams();
            q.set('year', y); q.set('month', m);
            
            // 드롭다운에서 선택된 과정 값 가져오기
            const selectedProgram = this.getSelectedMonthlyProgram();
            if(selectedProgram && selectedProgram !== '') {
              q.set('program_like', selectedProgram);
            }
            const res = await fetch(`/api/business/monthly-expected?${q.toString()}`);
            const out = await res.json();
            renderMonthlyExpectedTable(document.getElementById('monthly-expected'), out.items||[]);
            
            // 과정 필터 변경 시 차트도 새로고침
            await this.loadYearlyMonthlyChart(y);
          }catch(err){ console.error(err); }
        });
      }
      
      // 과정별 차트 필터 이벤트
      const courseFilter = document.getElementById('courseFilter');
      if(courseFilter){
        courseFilter.addEventListener('change', () => {
          if (this._chartData && this._chartYear) {
            const selectedPrograms = window.getSelectedPrograms ? window.getSelectedPrograms() : [];
            if (window.renderMonthlyRevenueChart) {
              window.renderMonthlyRevenueChart(this._chartData, this._chartYear, selectedPrograms);
            }
          }
        });
      }
    }

    showLoading(on){
      const overlay = document.getElementById('loadingOverlay');
      overlay.classList.toggle('hidden', !on);
    }

    async loadFilterOptions(){
      this.showLoading(true);
      try{
        const [yearsRes, quartersRes, teamRes] = await Promise.allSettled([
          fetch('/api/filters/years'),
          fetch('/api/filters/quarters'),
          fetch('/api/filters/team')
        ]);
        const years = yearsRes.status==='fulfilled' ? await yearsRes.value.json() : [];
        const quarters = quartersRes.status==='fulfilled' ? await quartersRes.value.json() : ['Q1','Q2','Q3','Q4'];
        const teams = teamRes.status==='fulfilled' ? await teamRes.value.json() : [];

        // 기본값은 '전체'로 두어 데이터가 숨겨지지 않도록 함
        this.state.year = '';
        this.state.quarter = '';
        this.state.category = '';

        const yearItems = [{label:'전체', value:''}].concat((years||[]).map(y=>({label:String(y), value:String(y)})));
        const quarterItems = [{label:'전체', value:''}].concat((quarters||[]).map(q=>({label:String(q), value:String(q)})));
        populateDropdown('yearDropdown', yearItems, '');
        populateDropdown('quarterDropdown', quarterItems, '');
        populateDropdown('categoryDropdown', [{label:'전체', value:''}].concat(teams.map(t=>({label:t, value:t}))), '');
      }catch(err){
        console.error(err);
      }finally{
        this.showLoading(false);
      }
    }

    async updateFilters(){
      await this.loadPrograms();
      await this.updateTabData();
      this.updateLastUpdated();
    }

    async loadPrograms(){
      this.showLoading(true);
      try{
        const params = new URLSearchParams();
        if(this.state.year) params.set('year', this.state.year);
        if(this.state.quarter) params.set('quarter', this.state.quarter);
        if(this.state.category) params.set('category', this.state.category);
        if(this.state.status) params.set('status', this.state.status);
        const res = await fetch(`/api/programs?${params.toString()}`);
        const data = await res.json();
        this.state.programsCache = Array.isArray(data) ? data : [];
      }catch(err){
        console.error(err);
        this.state.programsCache = [];
      }finally{
        this.showLoading(false);
      }
    }

    async updateTabData(){
      const active = document.querySelector('.tab-content.active');
      if(!active) return;
      const id = active.id;
      if(id==='dashboard-tab'){
        await this.updateDashboard();
      }else if(id==='education-tab'){
        await this.updateEducation();
      }else if(id==='business-tab'){
        await this.updateBusiness();
      }else if(id==='programs-tab'){
        await this.updatePrograms();
      }
    }

    // Dashboard
    async updateDashboard(){
      try{
        const params = new URLSearchParams();
        if(this.state.year) params.set('year', this.state.year);
        if(this.state.quarter) params.set('quarter', this.state.quarter);
        if(this.state.category) params.set('category', this.state.category);
        if(this.state.status) params.set('status', this.state.status);
        const kpiRes = await fetch(`/api/dashboard/kpi?${params.toString()}`);
        const kpis = await kpiRes.json();
        renderKpiCards(document.getElementById('dashboard-kpis'), [
          {label:'모객율', value: (kpis['모집률']||0).toFixed(2)+'%'},
          {label:'취업률', value: (kpis['취업률']||0).toFixed(2)+'%'},
          {label:'만족도', value: (kpis['만족도']||0).toFixed(2)},
          {label:'수료율', value: (kpis['수료율']||0).toFixed(2)+'%'}
        ], (label)=>{
          this.updateTrendChart(label);
          this.updateMetricButtonState(label);
        });
        await this.updateTrendChart();
      }catch(err){
        console.error(err);
      }
    }

    // 메트릭 버튼 상태 업데이트
    updateMetricButtonState(selectedMetric) {
      const metricBtns = document.querySelectorAll('.metric-btn');
      metricBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.metric === selectedMetric || 
            (selectedMetric === '' && btn.dataset.metric === '')) {
          btn.classList.add('active');
        }
      });
    }

    async updateTrendChart(metric){
      try{
        const params = new URLSearchParams();
        if(this.state.year) params.set('year', this.state.year);
        const res = await fetch(`/api/dashboard/trends?${params.toString()}`);
        const data = await res.json();
        const labels = data.map(d=>d.quarter);
        const datasets = [];
        const palette = {
          '모객율': '#4f46e5',
          '취업률': '#059669',
          '만족도': '#f59e0b',
          '수료율': '#ef4444'
        };
        // 백엔드 키와 프론트엔드 라벨 매핑
        const keyMapping = {
          '모객율': '모집률',
          '취업률': '취업률',
          '만족도': '만족도',
          '수료율': '수료율'
        };
        
        const keys = metric ? [metric] : ['모객율','취업률','만족도','수료율'];
        keys.forEach(k=>{
          const backendKey = keyMapping[k] || k;
          datasets.push({
            label: k,
            data: data.map(d=> {
              const value = d[backendKey] || 0;
              console.log(`[CHART DEBUG] ${d.quarter}: ${k}(${backendKey}) = ${value}`);
              return value;
            }),
            fill: false,
            borderColor: palette[k],
            backgroundColor: palette[k],
            tension: 0.2
          });
        });
        const ctx = document.getElementById('trendChart').getContext('2d');
        if(this.state.trendChart){ this.state.trendChart.destroy(); }
        this.state.trendChart = new Chart(ctx, {
          type: 'line',
          data: { labels, datasets },
          options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'top',
                labels: {
                  usePointStyle: true,
                  padding: 20,
                  font: {
                    size: 12,
                    weight: 'bold'
                  }
                }
              },
              tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                titleColor: 'white',
                bodyColor: 'white',
                borderColor: 'rgba(255, 255, 255, 0.2)',
                borderWidth: 1,
                callbacks: {
                  label: function(context) {
                    const label = context.dataset.label || '';
                    const value = context.parsed.y;
                    
                    if (label === '만족도') {
                      // 만족도의 경우 원래 5점 만점 점수도 표시
                      const originalScore = (value / 100 * 5).toFixed(1);
                      return `${label}: ${value}점 (${originalScore}/5점)`;
                    } else {
                      // 다른 지표들은 % 표시
                      return `${label}: ${value}%`;
                    }
                  }
                }
              }
            },
            scales: {
              x: {
                grid: {
                  color: 'rgba(0, 0, 0, 0.1)'
                },
                ticks: {
                  font: {
                    size: 11,
                    weight: 'bold'
                  }
                }
              },
              y: {
                beginAtZero: true,
                grid: {
                  color: 'rgba(0, 0, 0, 0.1)'
                },
                ticks: {
                  font: {
                    size: 11
                  },
                  callback: function(value) {
                    if (metric === '만족도') {
                      // 만족도 단일 지표 보기일 때만 원래 점수 병기
                      const originalScore = (value / 100 * 5).toFixed(1);
                      return `${value} (${originalScore}/5)`;
                    } else {
                      return value + '%';
                    }
                  }
                }
              }
            },
            interaction: {
              mode: 'nearest',
              axis: 'x',
              intersect: false
            },
            elements: {
              point: {
                radius: 6,
                hoverRadius: 8,
                borderWidth: 2,
                hoverBorderWidth: 3
              },
              line: {
                borderWidth: 3,
                tension: 0.4
              }
            }
          }
        });
      }catch(err){ console.error(err); }
    }

    // Education
    async updateEducation(){
      try{
        const y = this.state.year || '2025';
        const res = await fetch(`/api/education/counts?year=${encodeURIComponent(y)}`);
        const stats = await res.json();
        renderKpiCards(document.getElementById('education-kpis'), [
          {label:'전체 과정 수', value: String(stats['전체과정수']||0)},
          {label:'총 수강생', value: String(stats['총수강생']||0)}
        ]);
        
        // 타임라인 로드 (기본 상태 필터 '진행중')
        await this.loadTimeline(y, '진행중');
      }catch(err){ console.error(err); }
    }
    
    // 타임라인 로드
    async loadTimeline(year, status = '진행중') {
      try {
        const url = `/api/education/timeline/${year}?status=${encodeURIComponent(status)}`;
        const tRes = await fetch(url);
        const data = await tRes.json();
        
        // 상태에 따른 정보 배지 업데이트
        this.updateTimelineInfo(status, data.total_count || 0);
        
        // 타임라인 렌더링 (data.events 사용)
        renderTimeline(document.getElementById('education-timeline'), data.events || data);
        
        console.log(`[TIMELINE] ${year}년 ${status} 과정 ${data.total_count || 0}건 로드`);
      } catch(err) { 
        console.error('타임라인 로드 오류:', err); 
      }
    }
    
    // 타임라인 정보 배지 업데이트
    updateTimelineInfo(status, count) {
      const infoBadge = document.getElementById('timeline-info-badge');
      const statusToggle = document.querySelector('.timeline-status-toggle .status-text');
      
      if (infoBadge && statusToggle) {
        let infoText = '';
        let toggleText = '';
        
        switch(status) {
          case '진행중':
            infoText = `현재 진행중인 과정 ${count}건 표시`;
            toggleText = '진행중';
            break;
          case '종강':
            infoText = `종강된 과정 ${count}건 표시`;
            toggleText = '종강';
            break;
          case '전체':
            infoText = `전체 과정 ${count}건 표시`;
            toggleText = '전체';
            break;
        }
        
        infoBadge.innerHTML = `<i class="fa-solid fa-info-circle"></i> ${infoText}`;
        statusToggle.textContent = toggleText;
      }
    }

    // Business
    async updateBusiness(){
      try{
        const y = this.state.year || '2025';
        const data = await (await fetch(`/api/business/revenue-metrics?year=${encodeURIComponent(y)}`)).json();
        const totals = data.totals||{expected:0, actual:0, gap:0, max:0};
        const fmt = (n)=> Number(n||0).toLocaleString('ko-KR');
        renderKpiCards(document.getElementById('business-kpis'), [
          {label:'예상 매출 합계', value: fmt(totals.expected)},
          {label:'실 매출 합계', value: fmt(totals.actual)},
          {label:'차이 합계', value: fmt(totals.gap)},
          {label:'최대 가능 매출', value: fmt(totals.max)}
        ]);
        const quarterSel = document.getElementById('quarterFilter');
        const items = (data.items||[]);
        const applyFilter = ()=>{
          const q = quarterSel.value;
          const filtered = q ? items.filter(it=> String(it.quarter||'')===q) : items;
          renderRevenueTable(document.getElementById('business-table'), filtered);
        }
        if(quarterSel){
          quarterSel.removeEventListener('change', this._onQuarterChange);
          this._onQuarterChange = applyFilter;
          quarterSel.addEventListener('change', this._onQuarterChange);
        }
        applyFilter();

        // 연도별 12개월 매출 차트 로드
        await this.loadYearlyMonthlyChart(y);
        
        // 과정 선택 드롭다운 초기화
        await this.loadMonthlyProgramOptions();
      }catch(err){ console.error(err); }
    }

    // 연도별 12개월 매출 차트 로드
    async loadYearlyMonthlyChart(year) {
      try {
        const params = new URLSearchParams();
        params.set('year', year);
        
        // 과정 필터가 있다면 적용 (옵션)
        const programLike = document.getElementById('monthlyProgramLike')?.value?.trim();
        if (programLike) {
          params.set('program_like', programLike);
        }
        
        const res = await fetch(`/api/business/yearly-monthly-revenue?${params.toString()}`);
        const data = await res.json();
        
        // 과정 필터 드롭다운 업데이트
        if (window.updateCourseFilter && data.programs_list) {
          window.updateCourseFilter(data.programs_list);
        }
        
        // 선택된 과정들 가져오기
        const selectedPrograms = window.getSelectedPrograms ? window.getSelectedPrograms() : [];
        
        if (window.renderMonthlyRevenueChart) {
          window.renderMonthlyRevenueChart(data, year, selectedPrograms);
        }
        
        // 차트 데이터를 전역에 저장 (필터 변경 시 재사용)
        this._chartData = data;
        this._chartYear = year;
      } catch (err) {
        console.error('차트 로드 오류:', err);
      }
    }

    // Programs
    async updatePrograms(){
      const list = document.getElementById('programList');
      if(!this.state.programsCache.length){
        list.classList.add('empty-state');
        list.textContent = '등록된 과정이 없습니다.';
        return;
      }
      list.classList.remove('empty-state');
      renderProgramCards(list, this.state.programsCache, (program)=> this.openProgramModal(program));
    }

    openProgramModal(program){
      this._editingProgram = program || null;
      document.getElementById('programModalTitle').textContent = program ? '과정 수정' : '과정 등록';
      const form = document.getElementById('programForm');
      form.reset();
      if(program){
        const map = {
          '과정명': program['과정명']||program['HRD_Net_과정명']||'',
          'HRD_Net_과정명': program['HRD_Net_과정명']||'',
          '과정코드': program['과정코드']||'',
          '담당팀': program['담당팀']||program['팀']||program['과정구분']||'',
          '기수': program['기수']||program['배치']||'',
          '회차': program['회차']||'',
          '진행상태': program['진행상태']||'',
          '개강일': program['개강일']||program['개강']||'',
          '종강일': program['종강일']||program['종강']||'',
          '년도': program['년도']||'',
          '분기': program['분기']||'',
          '정원': program['정원']||'',
          'HRD_확정': program['HRD_확정']||'',
          '수료인원': program['수료인원']||'',
          '취업인원': program['취업인원']||'',
          '중도이탈': program['중도이탈']||'',
          '근로자': program['근로자']||'',
          '수료산정 제외인원': program['수료산정 제외인원']||program['산정제외']||'',
          '취업산정제외인원': program['취업산정제외인원']||'',
          'HRD_만족도': program['HRD_만족도']||''
        };
        Object.keys(map).forEach(k=>{ const el = form.querySelector(`[name="${k}"]`); if(el) el.value = map[k]; });
      }
      
      // 월별 데이터 입력 필드 생성
      this.initializeMonthlyInputs(program);
      
      document.getElementById('programModal').classList.remove('hidden');
      document.getElementById('programModal').setAttribute('aria-hidden','false');
    }

    closeProgramModal(){
      document.getElementById('programModal').classList.add('hidden');
      document.getElementById('programModal').setAttribute('aria-hidden','true');
      this._editingProgram = null;
    }

    // 월별 입력 필드 초기화
    initializeMonthlyInputs(program) {
      const toggleBtn = document.getElementById('toggleMonthlyData');
      const monthlyContent = document.getElementById('monthlyDataContent');
      const startInput = document.querySelector('[name="개강일"]');
      const endInput = document.querySelector('[name="종강일"]');
      
      // 토글 버튼 이벤트
      toggleBtn.onclick = () => {
        const isHidden = monthlyContent.classList.contains('hidden');
        monthlyContent.classList.toggle('hidden', !isHidden);
        toggleBtn.classList.toggle('expanded', isHidden);
        toggleBtn.innerHTML = `<i class="fa-solid fa-chevron-down"></i> ${isHidden ? '상세 입력 닫기' : '상세 입력'}`;
      };
      
      // 개강/종강일 변경 시 월별 필드 업데이트
      const updateMonthlyFields = () => {
        this.generateMonthlyFields(startInput.value, endInput.value, program?.id);
      };
      
      startInput.addEventListener('change', updateMonthlyFields);
      endInput.addEventListener('change', updateMonthlyFields);
      
      // 초기 로드
      if (program && startInput.value && endInput.value) {
        updateMonthlyFields();
      }
    }

    // 월별 입력 필드 생성
    generateMonthlyFields(startDate, endDate, programId) {
      const container = document.getElementById('monthlyInputs');
      container.innerHTML = '';
      
      if (!startDate || !endDate) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); font-style: italic;">개강일과 종강일을 입력해 주세요.</p>';
        return;
      }
      
      try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (start >= end) {
          container.innerHTML = '<p style="text-align: center; color: var(--danger); font-style: italic;">종강일이 개강일보다 빨라야 합니다.</p>';
          return;
        }
        
        const months = this.calculateMonthsBetween(start, end);
        
        months.forEach((monthInfo, index) => {
          const monthIndex = index + 1;
          const monthGroup = this.createMonthInputGroup(monthIndex, monthInfo, programId);
          container.appendChild(monthGroup);
        });
        
        // 기존 데이터 로드
        if (programId) {
          this.loadExistingMonthlyData(programId);
        }
        
      } catch (error) {
        container.innerHTML = '<p style="text-align: center; color: var(--danger); font-style: italic;">날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)</p>';
      }
    }

    // 두 날짜 사이의 월 계산
    calculateMonthsBetween(start, end) {
      const months = [];
      const current = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      
      while (current <= endMonth) {
        months.push({
          year: current.getFullYear(),
          month: current.getMonth() + 1,
          display: `${current.getFullYear()}년 ${current.getMonth() + 1}월`
        });
        current.setMonth(current.getMonth() + 1);
      }
      
      return months;
    }

    // 월별 입력 그룹 생성
    createMonthInputGroup(monthIndex, monthInfo, programId) {
      const group = document.createElement('div');
      group.className = 'monthly-input-group';
      group.innerHTML = `
        <div class="monthly-input-header">
          <span class="month-badge">${monthIndex}M</span>
          ${monthInfo.display}
        </div>
        <div class="monthly-input-fields">
          <div class="monthly-input-field">
            <label>수강 인원</label>
            <input type="number" name="monthly_enrollment_${monthIndex}" min="0" placeholder="0" />
          </div>
          <div class="monthly-input-field">
            <label>교육 시간</label>
            <input type="number" name="monthly_hours_${monthIndex}" min="0" placeholder="0" />
          </div>
        </div>
      `;
      return group;
    }

    // 기존 월별 데이터 로드
    async loadExistingMonthlyData(programId) {
      try {
        const [hoursRes, enrollRes] = await Promise.allSettled([
          fetch(`/api/programs/${programId}/monthly-hours`),
          fetch(`/api/programs/${programId}/monthly-enrollments`)
        ]);
        
        let hoursData = {};
        let enrollData = {};
        
        if (hoursRes.status === 'fulfilled' && hoursRes.value.ok) {
          hoursData = await hoursRes.value.json();
        }
        
        if (enrollRes.status === 'fulfilled' && enrollRes.value.ok) {
          enrollData = await enrollRes.value.json();
        }
        
        // 입력 필드에 데이터 채우기
        Object.keys(hoursData).forEach(key => {
          if (key !== 'id') {
            const monthMatch = key.match(/(\d+)M/);
            if (monthMatch) {
              const monthIndex = monthMatch[1];
              const input = document.querySelector(`[name="monthly_hours_${monthIndex}"]`);
              if (input) input.value = hoursData[key] || '';
            }
          }
        });
        
        Object.keys(enrollData).forEach(key => {
          if (key !== 'id') {
            const monthMatch = key.match(/(\d+)M/);
            if (monthMatch) {
              const monthIndex = monthMatch[1];
              const input = document.querySelector(`[name="monthly_enrollment_${monthIndex}"]`);
              if (input) input.value = enrollData[key] || '';
            }
          }
        });
        
      } catch (error) {
        console.error('월별 데이터 로드 오류:', error);
      }
    }

    async saveProgram(){
      const form = document.getElementById('programForm');
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());
      
      // 월별 데이터 수집
      const monthlyData = this.collectMonthlyData();
      if (monthlyData) {
        data.monthly_hours = monthlyData.hours;
        data.monthly_enrollments = monthlyData.enrollments;
      }
      
      const body = JSON.stringify(data);
      try{
        let res;
        if(this._editingProgram){
          res = await fetch(`/api/programs/${this._editingProgram.id}`, {method:'PUT', headers:{'Content-Type':'application/json'}, body});
        }else{
          res = await fetch('/api/programs', {method:'POST', headers:{'Content-Type':'application/json'}, body});
        }
        const out = await res.json();
        if(out.success){
          this.showToast('저장되었습니다.');
          this.closeProgramModal();
          await this.loadPrograms();
          await this.updatePrograms();
        }else{
          this.showToast(out.message||'실패했습니다.', true);
        }
      }catch(err){
        console.error(err);
        this.showToast('저장 중 오류가 발생했습니다.', true);
      }
    }

    // 월별 데이터 수집
    collectMonthlyData() {
      const hoursInputs = document.querySelectorAll('[name^="monthly_hours_"]');
      const enrollInputs = document.querySelectorAll('[name^="monthly_enrollment_"]');
      
      if (hoursInputs.length === 0 && enrollInputs.length === 0) {
        return null; // 월별 데이터가 없음
      }
      
      const hours = {};
      const enrollments = {};
      
      hoursInputs.forEach(input => {
        const match = input.name.match(/monthly_hours_(\d+)/);
        if (match) {
          const monthIndex = match[1];
          const value = parseInt(input.value) || 0;
          hours[`${monthIndex}M`] = value;
        }
      });
      
      enrollInputs.forEach(input => {
        const match = input.name.match(/monthly_enrollment_(\d+)/);
        if (match) {
          const monthIndex = match[1];
          const value = parseInt(input.value) || 0;
          enrollments[`${monthIndex}M`] = value;
        }
      });
      
      return { hours, enrollments };
    }

    async deleteProgram(){
      if(!this._editingProgram){ this.closeProgramModal(); return; }
      if(!confirm('정말 삭제하시겠습니까?')) return;
      try{
        const res = await fetch(`/api/programs/${this._editingProgram.id}`, {method:'DELETE'});
        const out = await res.json();
        if(out.success){
          this.showToast('삭제되었습니다.');
          this.closeProgramModal();
          await this.loadPrograms();
          await this.updatePrograms();
        }else{
          this.showToast(out.message||'삭제 실패', true);
        }
      }catch(err){ console.error(err); this.showToast('삭제 중 오류', true); }
    }

    updateLastUpdated(){
      const el = document.getElementById('lastUpdated');
      const now = new Date();
      el.textContent = `업데이트: ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    }

    showToast(msg, isError=false){
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.toggle('error', !!isError);
      t.classList.remove('hidden');
      setTimeout(()=> t.classList.add('hidden'), 1800);
    }
    
    // 타임라인 상태 필터 활성 상태 업데이트
    updateTimelineStatusActive(activeLink) {
      const menu = document.querySelector('.timeline-status-menu');
      if (menu) {
        menu.querySelectorAll('a').forEach(link => link.classList.remove('active'));
        activeLink.classList.add('active');
      }
    }
    
    // 타임라인 드롭다운 토글
    toggleTimelineDropdown(dropdown) {
      const isOpen = dropdown.classList.contains('open');
      this.closeTimelineDropdowns();
      if (!isOpen) {
        dropdown.classList.add('open');
        // 강제로 최상위로 올리기
        this.forceDropdownToTop(dropdown);
      }
    }
    
    // 타임라인 드롭다운 닫기
    closeTimelineDropdowns() {
      document.querySelectorAll('.timeline-status-dropdown').forEach(d => {
        d.classList.remove('open');
        // z-index 최상위 클래스 제거
        d.classList.remove('force-top');
      });
    }
    
    // 드롭다운을 강제로 최상위로 올리는 함수
    forceDropdownToTop(dropdown) {
      if (dropdown) {
        dropdown.classList.add('force-top');
        const menu = dropdown.querySelector('.dropdown-menu, .program-select-menu, .timeline-status-menu');
        if (menu) {
          menu.classList.add('force-top');
        }
      }
    }
    
    // 월별 예상 매출 조회의 선택된 과정 값 가져오기
    getSelectedMonthlyProgram() {
      const toggle = document.querySelector('.program-select-toggle .selected-text');
      if (toggle && toggle.textContent !== '과정 선택...') {
        return toggle.dataset.value || '';
      }
      return '';
    }
    
    // 과정 선택 드롭다운 초기화
    async loadMonthlyProgramOptions() {
      try {
        const res = await fetch('/api/programs');
        const programs = await res.json();
        const menu = document.querySelector('.program-select-menu');
        
        if (menu) {
          // 기존 메뉴 비우기 (전체 과정 옵션 제외)
          const allOption = menu.querySelector('li:first-child');
          menu.innerHTML = '';
          if (allOption) menu.appendChild(allOption);
          
          // 과정 데이터로 옵션 추가
          programs.forEach(program => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = '#';
            a.dataset.value = program['과정명'] || program['HRD_Net_과정명'] || '';
            
            const courseCode = program['과정코드'] || '';
            const courseName = program['과정명'] || program['HRD_Net_과정명'] || '';
            const round = program['회차'] || '';
            
            a.innerHTML = `
              <i class="fa-solid fa-graduation-cap"></i>
              <span class="program-info">
                <span class="program-name">${courseCode ? `[${courseCode}] ` : ''}${courseName}</span>
                ${round ? `<small class="program-round">${round}회차</small>` : ''}
              </span>
            `;
            
            li.appendChild(a);
            menu.appendChild(li);
          });
          
          this.bindProgramSelectEvents();
        }
      } catch (err) {
        console.error('과정 데이터 로드 오류:', err);
      }
    }
    
    // 과정 선택 드롭다운 이벤트 바인딩
    bindProgramSelectEvents() {
      const toggle = document.querySelector('.program-select-toggle');
      const menu = document.querySelector('.program-select-menu');
      const dropdown = document.querySelector('.program-select-dropdown');
      
      if (toggle) {
        toggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isOpen = dropdown?.classList.contains('open');
          
          // 다른 드롭다운 닫기
          document.querySelectorAll('.dropdown.open, .program-select-dropdown.open, .timeline-status-dropdown.open').forEach(d => {
            d.classList.remove('open', 'force-top');
          });
          
          if (!isOpen) {
            dropdown?.classList.add('open');
            // 강제로 최상위로 올리기
            this.forceDropdownToTop(dropdown);
          }
        });
      }
      
      if (menu) {
        menu.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const link = e.target.closest('a');
          if (link) {
            const value = link.dataset.value || '';
            const text = value ? link.querySelector('.program-name')?.textContent || '과정 선택...' : '전체 과정';
            
            const selectedText = toggle?.querySelector('.selected-text');
            if (selectedText) {
              selectedText.textContent = text;
              selectedText.dataset.value = value;
            }
            
            dropdown?.classList.remove('open', 'force-top');
          }
        });
      }
      
      // 외부 클릭 시 드롭다운 닫기
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.program-select-dropdown')) {
          dropdown?.classList.remove('open', 'force-top');
        }
      });
    }
  }

  // Components (helpers) will be in components.js
  document.addEventListener('DOMContentLoaded', ()=>{
    const app = new KDTDashboard();
    app.init();
  });

  // Expose class
  window.KDTDashboard = KDTDashboard;
})();


