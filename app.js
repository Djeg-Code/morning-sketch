"use strict";

/* =========================================================================
   Config & modes
   - ?test=1  → désactive le verrou journalier : chaque geste amène une
                nouvelle image tout de suite, sans rien "consommer".
   - ?reset=1 → efface la mémoire locale (images dessinées, image du jour).
   ========================================================================= */
const params = new URLSearchParams(location.search);
const TEST = params.has("test");
const RESET = params.has("reset");
const DATA_URL = "/api/data";

/* ---- Stockage local (persistant, hors Claude) ---- */
const store = {
  get(k){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):null; }catch(e){ return null; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} },
};
if (RESET) { store.del("drawn"); store.del("lastDone"); store.del("todayPick"); store.del("seenHint"); }

/* ---- Utilitaires ---- */
const $ = (id)=>document.getElementById(id);
const todayStr = ()=>{ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
function seedIndex(str, n){ let h=2166136261; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); } return n>0 ? (Math.abs(h)%n) : 0; }
function randInt(n){ return Math.floor(Math.random()*n); }

/* ---- Panneaux ---- */
const PANELS=["loading","error","empty","done"];
function show(name){
  PANELS.forEach(p=>$(p).classList.toggle("on", p===name));
  $("stage").classList.toggle("on", name==="stage");
}

/* ---- État ---- */
let ALL=[];        // [{id,src}]
let DRAWN={};      // {id:true}
let current=null;

/* ---- Données ---- */
async function fetchImages(){
  const res=await fetch(DATA_URL,{headers:{Accept:"application/json"}});
  if(!res.ok) throw new Error("http "+res.status);
  const data=await res.json();
  if(data && data.error) throw new Error(data.error);
  return (data.images||[]).map(x=>({id:String(x.id), src:x.src})).filter(x=>x.src);
}
function available(){ return ALL.filter(x=>!DRAWN[x.id]).sort((a,b)=>a.id<b.id?-1:1); }

/* Image du jour, stable tant qu'on ne valide pas (mode réel) */
function pickToday(force){
  const pool=available();
  if(pool.length===0){ current=null; return; }
  const t=todayStr();
  const saved=store.get("todayPick");
  if(!force && saved && saved.date===t){
    const hit=pool.find(x=>x.id===saved.id);
    if(hit){ current=hit; return; }
  }
  const idx=seedIndex(t+"|"+pool.length+"|"+(force?String(Date.now()):""), pool.length);
  current=pool[idx];
  store.set("todayPick",{date:t,id:current.id});
}

/* Image aléatoire différente (mode test) */
function pickRandom(){
  if(ALL.length===0){ current=null; return; }
  if(ALL.length===1){ current=ALL[0]; return; }
  let n; do { n=ALL[randInt(ALL.length)]; } while(current && n.id===current.id);
  current=n;
}

/* ---- Rendu ---- */
function resetTransform(){ scale=1; tx=0; ty=0; applyT(); }
function showImage(){
  $("img").src=current.src;
  resetTransform();
  show("stage");
  maybeHint();
}
function render(){
  if(TEST){
    if(ALL.length===0){ show("empty"); return; }
    if(!current) pickRandom();
    showImage(); return;
  }
  const t=todayStr();
  const lastDone=store.get("lastDone");
  if(available().length===0){ show("empty"); return; }
  if(lastDone===t){ $("donecount").textContent=Object.keys(DRAWN).length+" dessinées"; show("done"); return; }
  pickToday(false);
  if(!current){ show("empty"); return; }
  showImage();
}

/* ---- Actions ---- */
function validate(){            // double-tap : "j'ai dessiné"
  if(!current) return;
  if(!TEST){
    DRAWN[current.id]=true;
    store.set("drawn",DRAWN);
    store.set("lastDone",todayStr());
  }
  feedbackDrawn();
}
function skipDrawnBefore(){      // appui long : "déjà dessinée avant" / suivante
  if(!current) return;
  if(!TEST){
    DRAWN[current.id]=true;
    store.set("drawn",DRAWN);
  }
  caption(TEST ? "Suivante" : "Une autre");
  const img=$("img");
  img.classList.add("swap"); img.style.opacity="0";
  setTimeout(()=>{
    if(TEST) pickRandom(); else pickToday(true);
    if(!current){ img.classList.remove("swap"); render(); return; }
    img.src=current.src; resetTransform();
    requestAnimationFrame(()=>{ img.style.opacity="1"; });
    setTimeout(()=>img.classList.remove("swap"),320);
  },300);
}

/* ---- Retour visuel ---- */
function caption(text){
  const c=$("fxcap"); c.textContent=text; c.classList.add("show");
  clearTimeout(caption._t); caption._t=setTimeout(()=>c.classList.remove("show"),1300);
}
function feedbackDrawn(){
  const ring=$("ring"), ck=$("ck"), img=$("img");
  ring.classList.remove("play-ring"); ck.classList.remove("play-ck"); void ring.offsetWidth;
  ring.classList.add("play-ring"); ck.classList.add("play-ck");
  img.classList.add("dim");
  caption(TEST ? "Dessiné" : "Dessiné — à demain");
  setTimeout(()=>{
    img.classList.remove("dim");
    if(TEST){ pickRandom(); showImage(); } else { render(); }
  }, 1250);
}
function maybeHint(){
  if(store.get("seenHint")) return;
  const h=$("hint"); h.classList.add("show");
  setTimeout(()=>h.classList.remove("show"),4200);
  store.set("seenHint",true);
}

/* =========================================================================
   Gestes (Pointer Events)
   - pincer         → zoom (+ déplacement quand zoomé)
   - double-tap     → valider
   - appui long     → image suivante
   ========================================================================= */
let stage, imgEl;
let scale=1, tx=0, ty=0;
const MIN=1, MAX=6;
const pts=new Map();
let startDist=0, startScale=1, startMid={x:0,y:0}, startTx=0, startTy=0;
let downT=0, downX=0, downY=0, moved=false, lpTimer=null, lastTap=0;

function applyT(){ imgEl.style.transform="translate(-50%,-50%) translate("+tx+"px,"+ty+"px) scale("+scale+")"; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function mid(a,b){ return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; }

function bindGestures(){
  stage=$("stage"); imgEl=$("img");

  stage.addEventListener("pointerdown",(e)=>{
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1){
      downT=Date.now(); downX=e.clientX; downY=e.clientY; moved=false;
      clearTimeout(lpTimer);
      lpTimer=setTimeout(()=>{ if(pts.size===1 && !moved){ moved=true; skipDrawnBefore(); } },520);
    }else if(pts.size===2){
      clearTimeout(lpTimer); moved=true;
      const p=[...pts.values()];
      startDist=dist(p[0],p[1])||1; startScale=scale; startMid=mid(p[0],p[1]);
      startTx=tx; startTy=ty;
    }
  });

  stage.addEventListener("pointermove",(e)=>{
    if(!pts.has(e.pointerId)) return;
    const prev=pts.get(e.pointerId);
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===2){
      const p=[...pts.values()];
      const d=dist(p[0],p[1]);
      let ns=startScale*(d/startDist);
      ns=Math.max(MIN,Math.min(MAX,ns));
      const m=mid(p[0],p[1]);
      tx=startTx+(m.x-startMid.x);
      ty=startTy+(m.y-startMid.y);
      scale=ns; applyT();
    }else if(pts.size===1){
      const dx=e.clientX-downX, dy=e.clientY-downY;
      if(Math.hypot(dx,dy)>10){ moved=true; clearTimeout(lpTimer); }
      if(scale>1.01){ tx+=e.clientX-prev.x; ty+=e.clientY-prev.y; applyT(); }
    }
  });

  function endPointer(e){
    clearTimeout(lpTimer);
    const wasSingle=pts.size===1;
    pts.delete(e.pointerId);
    if(wasSingle){
      const dt=Date.now()-downT;
      if(!moved && dt<450){
        const now=Date.now();
        if(now-lastTap<320){ lastTap=0; validate(); }
        else{ lastTap=now; }
      }
    }
    if(pts.size<2 && scale<=1.02){
      scale=1; tx=0; ty=0;
      imgEl.style.transition="transform .25s ease"; applyT();
      setTimeout(()=>{ imgEl.style.transition=""; },260);
    }
    if(pts.size===1){ const p=[...pts.values()][0]; downX=p.x; downY=p.y; moved=true; }
  }
  stage.addEventListener("pointerup",endPointer);
  stage.addEventListener("pointercancel",endPointer);

  // molette = zoom (test sur ordinateur)
  stage.addEventListener("wheel",(e)=>{
    e.preventDefault();
    let ns=scale*(e.deltaY<0?1.12:0.89);
    ns=Math.max(MIN,Math.min(MAX,ns)); scale=ns;
    if(scale<=1.02){scale=1;tx=0;ty=0;}
    applyT();
  },{passive:false});

  document.addEventListener("contextmenu",(e)=>e.preventDefault());
}

/* ---- Démarrage ---- */
async function init(){
  show("loading");
  try{
    ALL = await fetchImages();
    DRAWN = store.get("drawn") || {};
    if(ALL.length===0){ $("errmsg").textContent="Aucune image reçue. Vérifie le channel côté serveur."; show("error"); return; }
    render();
  }catch(e){
    $("errmsg").textContent="Impossible de joindre le service. Réessaie dans un instant.";
    show("error");
  }
}

bindGestures();
$("retry").addEventListener("click", init);
init();
