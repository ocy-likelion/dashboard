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

      // Tabs
      document.querySelectorAll('aside nav li').forEach(li => {
        li.addEventListener('click', () => {
          document.querySelectorAll('aside nav li').forEach(x=>x.classList.remove('active'));
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

      // Dashboard control
      const btnAll = document.getElementById('btnAllMetrics');
      btnAll.addEventListener('click', ()=> this.updateTrendChart());

      // Business monthly expected
      const btnMonthly = document.getElementById('btnLoadMonthly');
      if(btnMonthly){
        btnMonthly.addEventListener('click', async ()=>{
          try{
            const y = document.getElementById('monthlyYear').value || (this.state.year || '2025');
            const m = document.getElementById('monthlyMonth').value || '7';
            const q = new URLSearchParams();
            q.set('year', y); q.set('month', m);
            const like = (document.getElementById('monthlyProgramLike').value||'').trim();
            if(like) q.set('program_like', like);
            const res = await fetch(`/api/business/monthly-expected?${q.toString()}`);
            const out = await res.json();
            renderMonthlyExpectedTable(document.getElementById('monthly-expected'), out.items||[]);
          }catch(err){ console.error(err); }
        });
      }

      // Business monthly revenue progression
      const btnProgression = document.getElementById('btnLoadProgression');
      if(btnProgression){
        btnProgression.addEventListener('click', async ()=>{
          try{
            const y = document.getElementById('progressionYear').value || (this.state.year || '2025');
            const like = (document.getElementById('progressionProgramLike').value||'').trim();
            const q = new URLSearchParams();
            q.set('year', y);
            if(like) q.set('program_like', like);
            const res = await fetch(`/api/business/monthly-revenue-progression?${q.toString()}`);
            const data = await res.json();
            
            this.renderProgressionChart(data);
            this.renderProgressionDetails(data);
          }catch(err){ 
            console.error('Error loading progression:', err); 
            this.showToast('데이터 로딩 중 오류가 발생했습니다.', true);
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
          {label:'모집률', value: (kpis['모집률']||0).toFixed(2)+'%'},
          {label:'취업률', value: (kpis['취업률']||0).toFixed(2)+'%'},
          {label:'만족도', value: (kpis['만족도']||0).toFixed(2)},
          {label:'수료율', value: (kpis['수료율']||0).toFixed(2)+'%'}
        ], (label)=>{
          this.updateTrendChart(label);
        });
        await this.updateTrendChart();
      }catch(err){
        console.error(err);
      }
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
          '모집률': '#4f46e5',
          '취업률': '#059669',
          '만족도': '#f59e0b',
          '수료율': '#ef4444'
        };
        const keys = metric ? [metric] : ['모집률','취업률','만족도','수료율'];
        keys.forEach(k=>{
          datasets.push({
            label: k,
            data: data.map(d=>d[k]||0),
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
          options: { responsive: true, maintainAspectRatio: false }
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
        const tRes = await fetch(`/api/education/timeline/${y}`);
        const timeline = await tRes.json();
        renderTimeline(document.getElementById('education-timeline'), timeline);
      }catch(err){ console.error(err); }
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

        // Monthly revenue (optional view): can be toggled or rendered below table
        // const m = await (await fetch(`/api/business/monthly-revenue?year=${encodeURIComponent(y)}`)).json();
        // TODO: attach a chart/table using m.months and m.items if needed
      }catch(err){ console.error(err); }
    }

    // Performance removed

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
      document.getElementById('programModal').classList.remove('hidden');
      document.getElementById('programModal').setAttribute('aria-hidden','false');
    }

    closeProgramModal(){
      document.getElementById('programModal').classList.add('hidden');
      document.getElementById('programModal').setAttribute('aria-hidden','true');
      this._editingProgram = null;
    }

    async saveProgram(){
      const form = document.getElementById('programForm');
      const data = Object.fromEntries(new FormData(form).entries());
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

    renderProgressionChart(data){
      const chartWrap = document.getElementById('progression-chart-wrap');
      const canvas = document.getElementById('progressionChart');
      
      if(!data.monthly_totals || data.monthly_totals.length === 0){
        chartWrap.style.display = 'none';
        return;
      }

      chartWrap.style.display = 'block';

      // Destroy existing chart
      if(window.progressionChartInstance){
        window.progressionChartInstance.destroy();
      }

      const ctx = canvas.getContext('2d');
      const months = data.monthly_totals.map(item => item.month);
      const revenues = data.monthly_totals.map(item => item.total_revenue);

      window.progressionChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: months,
          datasets: [{
            label: '월별 실 매출 (등차수열 기반)',
            data: revenues,
            borderColor: 'rgb(37, 99, 235)',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: 'rgb(37, 99, 235)',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top'
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  return `매출: ${formatCurrency(context.parsed.y)}`;
                }
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: function(value) {
                  return formatCurrency(value);
                }
              }
            },
            x: {
              title: {
                display: true,
                text: '월'
              }
            }
          }
        }
      });
    }

    renderProgressionDetails(data){
      const container = document.getElementById('progression-details');
      
      if(!data.programs || data.programs.length === 0){
        container.innerHTML = '<p style="text-align:center; color:#6b7280; padding:20px;">데이터가 없습니다.</p>';
        return;
      }

      let html = `
        <div class="progression-summary" style="background: var(--panel); border-radius: 16px; padding: 20px; margin: 20px 0; box-shadow: var(--shadow-md);">
          <h3 style="margin: 0 0 16px 0; color: var(--text);">등차수열 매출 분석 요약</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
            <div><strong>총 매출:</strong> ${formatCurrency(data.grand_total)}</div>
            <div><strong>분석 과정 수:</strong> ${data.programs.length}개</div>
            <div><strong>연도:</strong> ${data.year || '전체'}</div>
            ${data.program_filter ? `<div><strong>필터:</strong> ${data.program_filter}</div>` : ''}
          </div>
        </div>
        
        <div class="progression-programs" style="background: var(--panel); border-radius: 16px; padding: 20px; box-shadow: var(--shadow-md);">
          <h4 style="margin: 0 0 16px 0; color: var(--text);">과정별 상세 분석</h4>
      `;

      data.programs.forEach(program => {
        html += `
          <div class="program-detail" style="border: 1px solid rgba(226, 232, 240, 0.8); border-radius: 12px; padding: 16px; margin: 12px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <h5 style="margin: 0; color: var(--text);">${program.program} (${program.round}회차)</h5>
              <span style="font-weight: bold; color: var(--primary);">${formatCurrency(program.total_revenue)}</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; font-size: 14px; color: var(--muted);">
              <div>확정인원: ${program.confirmed}명</div>
              <div>수료인원: ${program.completed}명</div>
              <div>진행기간: ${program.duration_months}개월</div>
              <div>월감소율: ${program.decline_per_month}명/월</div>
            </div>
            <div style="margin-top: 12px;">
              <strong style="color: var(--text);">월별 변동:</strong>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                ${program.monthly_data.map(month => 
                  `<span style="background: var(--primary-50); padding: 4px 8px; border-radius: 8px; font-size: 12px;">
                    ${month.month}: ${month.enrollment.toFixed(1)}명 → ${formatCurrency(month.revenue)}
                  </span>`
                ).join('')}
              </div>
            </div>
          </div>
        `;
      });

      html += '</div>';
      container.innerHTML = html;
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


