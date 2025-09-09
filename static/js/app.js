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
        '#business-kpis','#revenueChart',
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
      }else if(id==='performance-tab'){
        await this.updatePerformance();
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
        const res = await fetch('/api/education/stats');
        const stats = await res.json();
        renderKpiCards(document.getElementById('education-kpis'), [
          {label:'전체 과정', value: String(stats['전체과정수']||0)},
          {label:'총 수강생', value: String(stats['총수강생']||0)},
          {label:'평균 수료율', value: ((stats['평균수료율']||0)).toFixed(2)+'%'},
          {label:'평균 취업률', value: ((stats['평균취업률']||0)).toFixed(2)+'%'}
        ]);
        const y = this.state.year || new Date().getFullYear();
        const tRes = await fetch(`/api/education/timeline/${y}`);
        const timeline = await tRes.json();
        renderTimeline(document.getElementById('education-timeline'), timeline);
      }catch(err){ console.error(err); }
    }

    // Business
    async updateBusiness(){
      try{
        const k = await (await fetch('/api/business/kpi')).json();
        renderKpiCards(document.getElementById('business-kpis'), [
          {label:'예산 집행률', value: (k['예산집행률']||0)+'%'},
          {label:'진행률', value: (k['진행률']||0)+'%'},
          {label:'목표 달성률', value: (k['목표달성률']||0)+'%'},
          {label:'총 매출', value: String(k['총매출']||0)},
          {label:'참여 인원', value: String(k['참여인원']||0)}
        ]);
        const trend = await (await fetch('/api/business/revenue-trend')).json();
        const ctx = document.getElementById('revenueChart').getContext('2d');
        if(this.state.revenueChart){ this.state.revenueChart.destroy(); }
        this.state.revenueChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: trend.labels,
            datasets: [
              {label:'현재년', data: trend.current, borderColor:'#4f46e5', backgroundColor:'#4f46e5', tension:0.2},
              {label:'전년', data: trend.previous, borderColor:'#6b7280', backgroundColor:'#6b7280', tension:0.2},
              {label:'목표', data: trend.goal, borderColor:'#ef4444', backgroundColor:'#ef4444', borderDash:[6,6], tension:0.2}
            ]
          },
          options: { responsive: true, maintainAspectRatio: false }
        });
      }catch(err){ console.error(err); }
    }

    // Performance
    async updatePerformance(){
      // 간단: 연간 달력 렌더 + KPI 요약
      const container = document.getElementById('performance-calendar');
      renderYearCalendar(container, this.state.year || new Date().getFullYear());
      const kpi = await (await fetch('/api/dashboard/kpi')).json();
      renderKpiCards(document.getElementById('performance-kpis'), [
        {label:'모집률', value: (kpi['모집률']||0).toFixed(2)+'%'},
        {label:'취업률', value: (kpi['취업률']||0).toFixed(2)+'%'},
        {label:'만족도', value: (kpi['만족도']||0).toFixed(2)},
        {label:'수료율', value: (kpi['수료율']||0).toFixed(2)+'%'}
      ]);
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
  }

  // Components (helpers) will be in components.js
  document.addEventListener('DOMContentLoaded', ()=>{
    const app = new KDTDashboard();
    app.init();
  });

  // Expose class
  window.KDTDashboard = KDTDashboard;
})();


