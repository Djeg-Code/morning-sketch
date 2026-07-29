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
if (RESET) {
  ["drawn","lastDone","todayPick","firstPicked","rewardTint",
   "citationOrder","citationCursor","citationFor",
   "usedQuotes","todayQuote"].forEach(k=>store.del(k));   // usedQuotes/todayQuote : anciennes clés (nettoyage)
}

/* ---- Utilitaires ---- */
const $ = (id)=>document.getElementById(id);
const todayStr = ()=>{ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); };
function randInt(n){ return Math.floor(Math.random()*n); }

/* ---- Panneaux ---- */
const PANELS=["loading","error","empty","done"];
function show(name){
  PANELS.forEach(p=>$(p).classList.toggle("on", p===name));
  $("stage").classList.toggle("on", name==="stage");
  if(name!=="done") $("done").classList.remove("lit");  // reset du fondu citation hors récompense
}

/* ---- État ---- */
let ALL=[];        // [{id,src}]
let DRAWN={};      // {id:true}
let current=null;
let seeding=false; // écran de première utilisation actif (choix de l'image de départ)
let QUOTES=[];     // [{text, author}] — citations parsées depuis citations.md
let SEEN={};       // {id:true} images déjà vues dans CETTE session (test/seed) ; NON persisté ; reset au reload

/* ---- Données ---- */
async function fetchImages(){
  const res=await fetch(DATA_URL,{headers:{Accept:"application/json"}});
  if(!res.ok) throw new Error("http "+res.status);
  const data=await res.json();
  if(data && data.error) throw new Error(data.error);
  return (data.images||[]).map(x=>({id:String(x.id), src:x.src, color:x.color||null})).filter(x=>x.src);
}
function available(){ return ALL.filter(x=>!DRAWN[x.id]).sort((a,b)=>a.id<b.id?-1:1); }

/* =========================================================================
   Citations (étape 6) — parsing de citations.md + citation du jour.
   Format d'une ligne : N. « citation » — Auteur
   Règle : citation = texte entre le PREMIER « et le DERNIER » ; auteur = ce qui
   suit ce dernier », « — » de tête retiré. Les textes ne sont JAMAIS modifiés.
   ========================================================================= */
function parseQuotes(txt){
  const out=[];
  for(const line of txt.split(/\r?\n/)){
    const s=line.trim();
    if(!s) continue;
    const a=s.indexOf("«"), b=s.lastIndexOf("»");
    if(a<0 || b<0 || b<=a) continue;
    const text=s.slice(a+1,b).trim();               // trim = uniquement le remplissage des guillemets
    let author=s.slice(b+1).replace(/^\s*[—–-]\s*/,"").trim();
    if(text) out.push({text, author});
  }
  return out;
}
async function fetchQuotes(){
  try{
    const r=await fetch("/citations.md",{headers:{Accept:"text/plain"}});
    if(!r.ok) return [];
    return parseQuotes(await r.text());
  }catch(e){ return []; }
}
/* =========================================================================
   Attribution des citations aux images (invariant anti-répétition — voir PLAN.md).
   La citation n'est plus choisie par date : elle est ASSIGNÉE à une image lors de
   sa 1re validation, via un ordre mélangé et persistant. Chaque citation n'apparaît
   donc qu'une seule fois (jusqu'à épuisement), exactement comme les images.
   ========================================================================= */
function shuffledIndices(n){                     // Fisher–Yates
  const a=[]; for(let i=0;i<n;i++) a.push(i);
  for(let i=n-1;i>0;i--){ const j=randInt(i+1); const t=a[i]; a[i]=a[j]; a[j]=t; }
  return a;
}
function initCitationOrder(){                     // ordre mélangé + curseur + map (généré à la validation du seed)
  store.set("citationOrder", shuffledIndices(QUOTES.length));
  store.set("citationCursor", 0);
  store.set("citationFor", {});
}
/* Citation d'une image (stable). Si l'image n'en a pas encore : on prend la
   prochaine de l'ordre mélangé et on avance le curseur. Si le curseur dépasse la
   longueur (cas images > citations), on remélange un nouveau cycle. */
function citationForImage(id){
  if(QUOTES.length===0 || id==null) return null;
  const map = store.get("citationFor") || {};
  if(map[id]!=null && QUOTES[map[id]]) return QUOTES[map[id]];   // déjà attribuée → stable
  let order = store.get("citationOrder");
  let cursor = store.get("citationCursor");
  if(!Array.isArray(order) || order.length!==QUOTES.length){ order = shuffledIndices(QUOTES.length); cursor=0; } // init paresseuse (ex. mode test sans seed)
  if(cursor==null || cursor>=order.length){ order = shuffledIndices(QUOTES.length); cursor=0; } // images > citations → nouveau cycle mélangé
  const qi = order[cursor]; cursor++;
  map[id]=qi;
  store.set("citationOrder",order); store.set("citationCursor",cursor); store.set("citationFor",map);
  return QUOTES[qi];
}

/* Remplit l'écran de récompense avec la citation de l'image (entre guillemets) + l'auteur. */
function fillReward(imgId){
  const id = imgId || (current && current.id);
  const q = citationForImage(id);
  const qt=$("quote-text"), qa=$("quote-author");
  if(q){
    qt.textContent="« "+q.text+" »";
    qa.textContent=q.author ? "— "+q.author : "";
  }else{ qt.textContent=""; qa.textContent=""; }
}

/* Image du jour : tirage ALÉATOIRE dans le pool disponible, verrouillé pour la journée
   via todayPick (stable tant qu'on ne valide pas ; exclut les images déjà dessinées). */
function pickToday(force){
  const pool=available();
  if(pool.length===0){ current=null; return; }
  const t=todayStr();
  const saved=store.get("todayPick");
  if(!force && saved && saved.date===t){
    const hit=pool.find(x=>x.id===saved.id);
    if(hit){ current=hit; return; }
  }
  // Tirage aléatoire ; si possible, différent de l'image courante (cas « une autre »).
  let pick=pool[randInt(pool.length)];
  if(pool.length>1 && current){
    let guard=0;
    while(pick.id===current.id && guard++<8){ pick=pool[randInt(pool.length)]; }
  }
  current=pick;
  store.set("todayPick",{date:t,id:current.id});
}

/* Image aléatoire JAMAIS revue (mode test & seed) : exclut drawn (permanent) ET
   seen (session), puis marque l'image tirée comme vue. current=null si pool vide. */
function pickFresh(){
  const pool = ALL.filter(x=>!DRAWN[x.id] && !SEEN[x.id]);
  if(pool.length===0){ current=null; return; }
  const n = pool[randInt(pool.length)];
  SEEN[n.id]=true;
  current=n;
}

/* ---- Rendu ---- */
function resetTransform(){ scale=1; tx=0; ty=0; applyT(); }
function showImage(){
  $("img").src=current.src;
  resetTransform();
  show("stage");
}
function render(){
  if(TEST){
    if(!current) pickFresh();
    if(!current){ show("empty"); return; }   // pool épuisé (toutes vues) → pool épuisée
    showImage(); return;
  }
  const t=todayStr();
  const lastDone=store.get("lastDone");
  if(available().length===0){ show("empty"); return; }
  if(lastDone===t){
    const tint=store.get("rewardTint"); if(tint) $("done").style.background=tint;
    const tp=store.get("todayPick");
    fillReward(tp && tp.id);                   // citation de l'image dessinée aujourd'hui (stable)
    show("done");
    requestAnimationFrame(()=>$("done").classList.add("lit"));
    return;
  }
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
  const img=$("img");
  img.classList.add("swap"); img.style.opacity="0";
  setTimeout(()=>{
    if(TEST) pickFresh(); else pickToday(true);
    if(!current){ img.classList.remove("swap"); render(); return; }
    img.src=current.src; resetTransform();
    requestAnimationFrame(()=>{ img.style.opacity="1"; });
    setTimeout(()=>img.classList.remove("swap"),320);
  },300);
}

/* =========================================================================
   Teinte de l'écran de récompense (étape 5) — couleur représentative de l'image.
   Couleur PLEINE (pas de mélange avec du noir) ; la citation (étape 6) sera posée
   par-dessus en mix-blend-mode:difference, donc lisible quelle que soit la teinte.
   Cascade : voie 1 (couleur are.na) → voie 2 (moyenne client) → voie 3 (pixel vif)
   → voie 4 (repli neutre si canvas tainted / onerror).
   ========================================================================= */
const FALLBACK_TINT="#3A3A42"; // TODO voie 4 : repli neutre si extraction impossible.
                               // Un endpoint /api/color?id= pourra être ajouté ensuite.
function rgbCss(c){ return "rgb("+c[0]+","+c[1]+","+c[2]+")"; }
function averageColor(d){       // moyenne des pixels opaques
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<d.length;i+=4){ if(d[i+3]<125) continue; r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++; }
  return n ? [Math.round(r/n),Math.round(g/n),Math.round(b/n)] : null;
}
function isDull(c){              // couleur fade/indéfinie : quasi grise
  if(!c) return true;
  const mx=Math.max(c[0],c[1],c[2]), mn=Math.min(c[0],c[1],c[2]);
  const sat=mx===0?0:(mx-mn)/mx;
  return (mx-mn)<18 || sat<0.08;
}
function vividPixel(d){          // voie 3 : échantillonne quelques pixels, garde le plus saturé
  let best=null,score=-1;
  for(let k=0;k<48;k++){
    const i=(Math.floor(Math.random()*(d.length/4)))*4;
    if(d[i+3]<125) continue;
    const s=Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2]);
    if(s>score){ score=s; best=[d[i],d[i+1],d[i+2]]; }
  }
  return best;
}
function extractColor(src, cb){  // voie 2/3, repli voie 4 — sans toucher #img affiché
  const probe=new Image();
  probe.crossOrigin="anonymous";           // impératif AVANT .src pour un canvas non tainted
  probe.onload=()=>{
    try{
      const cv=document.createElement("canvas"); cv.width=40; cv.height=40;
      const ctx=cv.getContext("2d",{willReadFrequently:true});
      ctx.drawImage(probe,0,0,40,40);
      const d=ctx.getImageData(0,0,40,40).data;   // lève si le canvas est tainted (CDN sans CORS)
      let c=averageColor(d);
      if(isDull(c)){ const v=vividPixel(d); if(v) c=v; }   // voie 3
      cb(c?rgbCss(c):FALLBACK_TINT);
    }catch(e){ cb(FALLBACK_TINT); }               // voie 4 : tainted / lecture impossible
  };
  probe.onerror=()=>cb(FALLBACK_TINT);            // voie 4 : chargement échoué
  probe.src=src;
}
function tintReward(src){        // applique la teinte au fond de l'écran de récompense (#done)
  const done=$("done");
  const apply=(col)=>{ done.style.background=col; store.set("rewardTint",col); };
  if(current && current.color){ apply(current.color); return; }  // voie 1 : couleur are.na
  if(!src){ apply(FALLBACK_TINT); return; }
  extractColor(src, apply);
}

/* ---- Retour visuel (purement visuel : anneau + coche en lumière, sans texte) ---- */
function feedbackDrawn(){
  const ring=$("ring"), ck=$("ck"), img=$("img");
  ring.classList.remove("play-ring"); ck.classList.remove("play-ck"); void ring.offsetWidth;
  ring.classList.add("play-ring"); ck.classList.add("play-ck");
  img.classList.add("dim");
  tintReward(current ? current.src : null);   // extraction + teinte du fond de récompense
  fillReward();                               // citation (du jour, ou aléatoire en test)
  setTimeout(()=>{
    img.classList.remove("dim");
    const done=$("done");
    if(TEST){
      show("done");                            // en test : montrer l'écran teinté + citation...
      requestAnimationFrame(()=>done.classList.add("lit"));
      setTimeout(()=>{ pickFresh(); if(current){ showImage(); } else { show("empty"); } }, 1900); // ...puis image suivante (jamais revue)
    } else {
      render();                                // mode normal : render() affiche "done" (verrou du jour)
      requestAnimationFrame(()=>done.classList.add("lit")); // fondu citation synchro avec la teinte
    }
  }, 1250);
}

/* =========================================================================
   Écran de première utilisation (seed) — étape 3
   Au tout premier lancement (flag `firstPicked` absent). L'utilisateur clique
   « seed » jusqu'à obtenir l'image de départ voulue, puis « valider » pour la
   verrouiller comme image du jour et basculer en mode normal.
   ⚠️ « valider » ici = « c'est mon image de départ » (≠ double-tap « j'ai dessiné »).
   ========================================================================= */
function startSeed(){
  seeding=true;
  $("seed-cta").classList.add("on");
  pickFresh();                  // 1re candidate jamais revue (exclut drawn + seen)
  if(!current){ show("empty"); return; }
  showImage();
}
function seedNext(){            // CTA « seed » : nouvelle candidate jamais revue, changement instantané
  if(!seeding) return;
  pickFresh();                  // exclut drawn + déjà vues de la session
  if(!current){ seeding=false; $("seed-cta").classList.remove("on"); show("empty"); return; } // plus de candidate
  const img=$("img");
  img.src=current.src;
  resetTransform();
}
function seedConfirm(){         // CTA « valider » : verrouille l'image de départ
  if(!seeding || !current) return;
  store.set("firstPicked",true);
  store.set("todayPick",{date:todayStr(),id:current.id});
  initCitationOrder();          // ordre de citations mélangé + persistant (assignation aux images)
  seeding=false;
  $("seed-cta").classList.remove("on");
  render();                     // mode normal : render() restaure todayPick → cette image
}

/* =========================================================================
   Gestes (Pointer Events)
   - pincer         → zoom (+ déplacement quand zoomé)
   - double-tap     → valider
   - appui long     → image suivante
   ========================================================================= */
let stage, imgEl;
let scale=1, tx=0, ty=0;
let rot=0;                    // rotation de base de l'image courante (0 ou ROT_ANGLE) ; indépendante des gestes
const ROT_ANGLE=90;          // sens de rotation des paysages (mettre -90 si l'orientation semble contre-intuitive)
const MIN=1, MAX=6;
const pts=new Map();
let startDist=0, startScale=1, startMid={x:0,y:0}, startTx=0, startTy=0;
let downT=0, downX=0, downY=0, moved=false, lpTimer=null, lastTap=0;

/* Rotation appliquée EN FIN de chaîne : le pincer (scale) et le déplacement (tx/ty)
   restent en repère écran ; resetTransform() conserve la rotation de base. */
function applyT(){ imgEl.style.transform="translate(-50%,-50%) translate("+tx+"px,"+ty+"px) scale("+scale+") rotate("+rot+"deg)"; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function mid(a,b){ return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; }

function bindGestures(){
  stage=$("stage"); imgEl=$("img");

  /* Détection du format à chaque chargement d'image : les paysages sont tournés de 90°
     (dimensions inversées via la classe .rot) pour occuper au mieux l'écran portrait. */
  imgEl.addEventListener("load",()=>{
    rot = (imgEl.naturalWidth > imgEl.naturalHeight) ? ROT_ANGLE : 0;
    imgEl.classList.toggle("rot", rot!==0);
    applyT();
  });

  stage.addEventListener("pointerdown",(e)=>{
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pts.size===1){
      downT=Date.now(); downX=e.clientX; downY=e.clientY; moved=false;
      clearTimeout(lpTimer);
      lpTimer=setTimeout(()=>{ if(!seeding && pts.size===1 && !moved){ moved=true; skipDrawnBefore(); } },520);
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
      if(!seeding && !moved && dt<450){
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
    const [imgs, quotes] = await Promise.all([fetchImages(), fetchQuotes()]);
    ALL = imgs; QUOTES = quotes;   // fetchQuotes ne rejette jamais (retourne [] en cas d'échec)
    DRAWN = store.get("drawn") || {};
    if(ALL.length===0){ show("error"); return; }
    // Tout premier lancement (hors mode test) → écran de choix de l'image de départ.
    if(!TEST && !store.get("firstPicked")){ startSeed(); return; }
    render();
  }catch(e){
    show("error");
  }
}

bindGestures();
$("error").addEventListener("click", init);        // écran d'erreur tappable pour relancer
$("seed-new").addEventListener("click", seedNext); // CTA « seed »   : nouvelle candidate
$("seed-ok").addEventListener("click", seedConfirm);// CTA « valider » : verrouille le départ
init();
