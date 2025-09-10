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
})();


