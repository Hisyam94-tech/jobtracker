import {escapeHtml as e, icon, modal} from './ui.js';

const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const dateValue = key => new Date(key + 'T12:00:00');
const label = key => key ? dateValue(key).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'Select date';
const length = (from,to) => Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;

export function openDateRange(current, onApply) {
    const now = new Date(), today = dateKey(now);
    const presets = {
        month: {from:dateKey(new Date(now.getFullYear(),now.getMonth(),1)),to:today},
        week: {from:dateKey(new Date(now.getFullYear(),now.getMonth(),now.getDate()-6)),to:today},
        previous: {from:dateKey(new Date(now.getFullYear(),now.getMonth()-1,1)),to:dateKey(new Date(now.getFullYear(),now.getMonth(),0))}
    };
    let from=current.from, to=current.to, phase='start', month=dateValue(from), error='';
    month.setDate(1);
    const dialog=modal('Reporting period','');
    dialog.classList.add('range-dialog','calendar-dialog');
    const body=dialog.querySelector('.dialog-body');

    function render(focus) {
        const year=month.getFullYear(), number=month.getMonth();
        const offset=(new Date(year,number,1).getDay()+6)%7;
        const count=new Date(year,number+1,0).getDate();
        const cells=Array.from({length:Math.ceil((offset+count)/7)*7},(_,index)=>{
            const day=index-offset+1;
            if(day<1 || day>count) return '<span aria-hidden="true"></span>';
            const key=dateKey(new Date(year,number,day));
            const selected=key===from || key===to;
            const between=Boolean(to && key>from && key<to);
            const inRange=Boolean(to && from!==to && key>=from && key<=to);
            return `<button type="button" data-date="${key}" class="calendar-day ${selected?'selected':''} ${between?'between':''} ${inRange?'in-range':''} ${key===from?'range-start':''} ${key===to?'range-end':''} ${key===today?'today':''}" aria-label="${e(dateValue(key).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}))}" aria-pressed="${selected}" ${key===today?'aria-current="date"':''}><span>${day}</span></button>`;
        }).join('');
        body.innerHTML=`<p class="range-intro">Tap a start date, then an end date.</p><div class="range-presets" role="group" aria-label="Quick date ranges">${[['month','This month'],['week','Last 7 days'],['previous','Last month']].map(([key,text])=>`<button type="button" data-preset="${key}" aria-pressed="${from===presets[key].from && to===presets[key].to}">${text}</button>`).join('')}</div><div class="calendar-selection" role="group" aria-label="Selected dates"><button type="button" data-phase="start" aria-pressed="${phase==='start'}"><small>Start date</small><strong>${e(label(from))}</strong></button><span aria-hidden="true">${icon('arrow')}</span><button type="button" data-phase="end" aria-pressed="${phase==='end'}"><small>End date</small><strong>${e(label(to))}</strong></button></div><div class="calendar-month"><button type="button" data-move="-1" aria-label="Previous month">${icon('arrow')}</button><h3 aria-live="polite">${e(month.toLocaleDateString('en-GB',{month:'long',year:'numeric'}))}</h3><button type="button" data-move="1" aria-label="Next month">${icon('arrow')}</button></div><div class="calendar-weekdays" aria-hidden="true">${['M','T','W','T','F','S','S'].map(day=>`<span>${day}</span>`).join('')}</div><div class="calendar-days" role="group" aria-label="Choose ${phase} date">${cells}</div><p class="calendar-message ${error?'calendar-error':''}" ${error?'role="alert"':'role="status"'}>${error?e(error):to?`${length(from,to)} days selected &middot; Up to 31 days`:'Choose your end date &middot; Up to 31 days'}</p><div class="range-actions"><button class="secondary" type="button" data-cancel>Cancel</button><button class="primary" type="button" data-apply ${!to?'disabled':''}>Apply dates ${icon('arrow')}</button></div>`;
        if(focus) body.querySelector(focus)?.focus({preventScroll:true});
    }
    body.addEventListener('click',event=>{
        const button=event.target.closest('button');
        if(!button || button.disabled) return;
        if(button.hasAttribute('data-cancel')) {dialog.close();return;}
        if(button.hasAttribute('data-apply')) {
            if(!to || length(from,to)<1 || length(from,to)>31) return;
            dialog.close();onApply({from,to});return;
        }
        error='';
        if(button.dataset.preset) {
            ({from,to}=presets[button.dataset.preset]);phase='start';month=dateValue(from);month.setDate(1);
            render(`[data-preset="${button.dataset.preset}"]`);return;
        }
        if(button.dataset.move) {
            month=new Date(month.getFullYear(),month.getMonth()+Number(button.dataset.move),1);
            render(`[data-move="${button.dataset.move}"]`);return;
        }
        if(button.dataset.phase) {
            phase=button.dataset.phase;
            month=dateValue(phase==='end' && to?to:from);month.setDate(1);
            render(`[data-phase="${phase}"]`);return;
        }
        if(button.dataset.date) {
            const chosen=button.dataset.date;
            if(phase==='start' || chosen<from) {from=chosen;to=null;phase='end';}
            else if(length(from,chosen)>31) error='Choose an end date within 31 days of the start date.';
            else {to=chosen;phase='start';}
            render(`[data-date="${chosen}"]`);
        }
    });
    body.addEventListener('keydown',event=>{
        const day=event.target.closest('[data-date]');
        const deltas={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
        if(!day || !(event.key in deltas)) return;
        event.preventDefault();
        const next=dateValue(day.dataset.date);next.setDate(next.getDate()+deltas[event.key]);
        month=new Date(next.getFullYear(),next.getMonth(),1);
        render(`[data-date="${dateKey(next)}"]`);
    });
    render();
    return dialog;
}
