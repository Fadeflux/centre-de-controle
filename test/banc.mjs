// ============================================================================
//  BANC D'ESSAI DU CENTRE DE CONTRÔLE
//  Lancer :  node test/banc.mjs
//  Comparer avec une version précédente :  node test/banc.mjs chemin/vers/ancien.html
//
//  ⚠️ POURQUOI CE FICHIER EXISTE. Les bugs qu'il surveille ne se voient PAS en
//  relisant le code : ce sont des questions de TEMPS (une réponse réseau qui
//  arrive après un clic) et de SAISIE (ce que l'opérateur tape vraiment). On
//  les rejoue donc pour de bon, avec un faux réseau dont on contrôle le délai.
//
//  Chaque vérification a été prouvée en la relançant sur le code d'AVANT la
//  correction : elle DOIT échouer là-bas. Un test qui passe des deux côtés ne
//  prouve rien.
//
//  Ce que ça garde :
//   1. Payer pendant que le cahier de paie est en train d'être relu ne doit pas
//      faire redevenir le VA « à payer » (sinon : second clic = DOUBLE PAIEMENT).
//   2. Un objectif de VA tapé de travers (« 5o ») ne doit pas SUPPRIMER l'objectif.
//   3. Un revenu Telegram saisi pendant une panne serveur ne doit pas disparaître
//      quand le serveur revient.
//   4. « OnlyChat est en train de recalculer » ne doit pas passer pour un zéro
//      certain : le bandeau rouge doit s'afficher.
// ============================================================================
// Banc d'essai : on rejoue la COURSE reelle, on ne relit pas le code.
import fs from "fs";
const FICH = process.argv[2] || new URL("../index.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,"$1");
const src = fs.readFileSync(FICH,"utf8");
function morceau(debut, fin){
  const i = src.indexOf(debut); if(i<0) throw new Error("introuvable: "+debut);
  const j = src.indexOf(fin, i);  if(j<0) throw new Error("fin introuvable: "+fin);
  return src.slice(i, j);
}
const bloc = morceau("function isPaid(va){", "// ⚠️ On n'envoie PLUS toute la liste")
           + morceau("let PAYMENTS_LOADED=false;", "function _assocVide(")
           + morceau("function savePayments(delta){", "// ⚠️ LE CAHIER DE PAIE");

// --- decor minimal ---
let toasts=[], reseau=[];
const ctx = {
  TOKEN:"jeton", HUB_BASE:"http://x", PAYMENTS:[], LAST:{},
  localStorage:{ _d:{}, setItem(k,v){this._d[k]=v;}, getItem(k){return this._d[k]??null;} },
  renderPaie(){}, toast:(a,b)=>toasts.push(a+" | "+b),
  curPeriod:()=>"2026-09-Q1",
  fetch:null,
};
const noms = Object.keys(ctx);
const fabrique = new Function(...noms, bloc + "; return {loadPayments, savePayments, payVa, unpayVa, isPaid, get PAYMENTS(){return PAYMENTS;}, set PAYMENTS(v){PAYMENTS=v;}, get PAYMENTS_LOADED(){return PAYMENTS_LOADED;}};");

function neuf(reponseGet, delaiMs){
  toasts=[]; reseau=[];
  ctx.PAYMENTS=[];
  ctx.fetch = (url,o)=>{
    reseau.push((o&&o.method)||"GET");
    if(o && o.method==="POST") return Promise.resolve({ok:true,status:200,json:async()=>({})});
    return new Promise(res=>setTimeout(()=>res({ok:true,status:200,json:async()=>reponseGet()}), delaiMs));
  };
  const vals = noms.map(n=>n==="fetch"?((u,o)=>ctx.fetch(u,o)):ctx[n]);
  return fabrique(...vals);
}

let ko=0;
function verifie(nom, cond, detail){ if(cond){ console.log("  OK  "+nom); } else { ko++; console.log("  KO  "+nom+" -> "+detail); } }
const V=verifie;

// ---- 1) LA COURSE : lecture en vol, on paie pendant, la reponse est perimee ----
{
  const m = neuf(()=>({payments:[]}), 60);          // le serveur repond la photo AVANT le paiement
  const lecture = m.loadPayments();                  // part a t=0, repond a t=60ms
  await new Promise(r=>setTimeout(r,10));
  m.payVa("Welzy", 150);                             // l'operateur clique a t=10ms
  const apresClic = m.isPaid("Welzy");
  await lecture; await new Promise(r=>setTimeout(r,80));
  verifie("le clic Payer survit a une lecture deja en vol",
    apresClic && m.isPaid("Welzy"),
    "Welzy est redevenu 'a payer' -> second clic -> DOUBLE PAIEMENT (paye="+m.isPaid("Welzy")+")");
  verifie("le cahier reste lisible malgre la reponse ecartee", m.PAYMENTS_LOADED===true, "PAYMENTS_LOADED="+m.PAYMENTS_LOADED);
}

// ---- 2) SANS ecriture concurrente, la lecture fait bien autorite ----
{
  const m = neuf(()=>({payments:[{id:"a",va:"Lina",amount:90,period:"2026-09-Q1",ts:1}]}), 5);
  await m.loadPayments();
  verifie("une lecture tranquille remplace bien l'etat local", m.isPaid("Lina"), "Lina devrait etre payee d'apres le serveur");
}

// ---- 3) DEUX lectures lancees ensemble : une seule part ----
{
  const m = neuf(()=>({payments:[]}), 30);
  const a=m.loadPayments(), b=m.loadPayments();
  await Promise.all([a,b]); await new Promise(r=>setTimeout(r,40));
  const gets = reseau.filter(x=>x==="GET").length;
  verifie("pas deux lectures qui se doublent", gets===1, gets+" GET partis au lieu d'1");
}

// ---- 4) le paiement part quand meme au serveur (delta) ----
{
  const m = neuf(()=>({payments:[]}), 60);
  const l = m.loadPayments();
  await new Promise(r=>setTimeout(r,10));
  m.payVa("Welzy",150);
  await l; await new Promise(r=>setTimeout(r,80));
  verifie("le serveur a bien recu le paiement", reseau.includes("POST"), "aucun POST : la paie n'existerait que sur cet ecran");
}


// ================= 1) objectif par VA : une faute de frappe ne doit rien effacer
{
  const bloc = morceau("function setVaGoal(va){", "// 🪄 Appliquer les objectifs");
  let VA_GOALS={Welzy:40}, sauve=0, toasts=[];
  const f = new Function("VA_GOALS","prompt","suggestVaGoal","saveVaGoals","toast","OM_DATA","renderOM",
    bloc + "; return setVaGoal;");
  const faire = (saisie)=>{ toasts=[]; return f(VA_GOALS, ()=>saisie, ()=>null, ()=>{sauve++;}, (a,b)=>toasts.push(a), null, ()=>{})("Welzy"); };

  faire("5o");   // lettre o au lieu du zero
  V("« 5o » ne SUPPRIME pas l'objectif", VA_GOALS.Welzy===40, "objectif devenu "+JSON.stringify(VA_GOALS.Welzy)+" (il valait 40)");
  V("et l'operateur est prevenu", toasts.length>0, "aucun message : la disparition est silencieuse");
  faire("50 subs");
  V("« 50 subs » ne supprime pas non plus", VA_GOALS.Welzy===40, "objectif devenu "+JSON.stringify(VA_GOALS.Welzy));
  faire("50");
  V("un vrai nombre passe toujours", VA_GOALS.Welzy===50, "objectif = "+JSON.stringify(VA_GOALS.Welzy));
  faire("");
  V("vider le champ retire bien l'objectif (geste explicite)", VA_GOALS.Welzy===undefined, "reste "+JSON.stringify(VA_GOALS.Welzy));
  VA_GOALS.Welzy=40; faire("0");
  V("taper 0 retire bien l'objectif", VA_GOALS.Welzy===undefined, "reste "+JSON.stringify(VA_GOALS.Welzy));
}

// ================= 2) Telegram : la saisie retenue ne doit pas disparaitre
{
  const bloc = morceau("let TGREV_LOADED", "function tgMonthKey(");
  let TGREV=[], reponse={entries:[{id:"srv1",amount:500,ts:1}]}, envois=[], toasts=[];
  const noms=["TOKEN","HUB_BASE","localStorage","fetch","toast","renderTgrev"];
  const dec={ TOKEN:"j", HUB_BASE:"http://x",
    localStorage:{_d:{},setItem(){},getItem(){return null;}},
    fetch:(u,o)=>{ if(o&&o.method==="POST"){ envois.push(JSON.parse(o.body)); return Promise.resolve({ok:true}); }
                   return Promise.resolve({ok:true, json:async()=>reponse}); },
    toast:(a)=>toasts.push(a), renderTgrev:()=>{} };
  const api = new Function(...noms, "let TGREV=[];"+bloc+"; return {saveTgrev, loadTgrev, get TGREV(){return TGREV;}, set TGREV(v){TGREV=v;}, get LOADED(){return TGREV_LOADED;}};")
    (...noms.map(n=>n==="fetch"?((u,o)=>dec.fetch(u,o)):dec[n]));

  // le serveur est muet au demarrage -> la lecture n'a pas eu lieu
  api.TGREV=[{id:"local1", amount:800, ts:2}];
  api.saveTgrev();                                     // verrou : rien ne part
  V("rien n'est envoye tant que le serveur n'a pas ete lu", envois.length===0, envois.length+" envoi(s) : le serveur aurait ete ECRASE");
  await api.loadTgrev();                               // le serveur repond enfin
  const ids = api.TGREV.map(x=>x.id).sort().join(",");
  V("la saisie faite pendant la panne SURVIT", ids==="local1,srv1", "il reste : "+ids);
  await new Promise(r=>setTimeout(r,5));
  V("et elle est rejouee vers le serveur", envois.length===1 && envois[0].entries.some(x=>x.id==="local1"),
    "envois="+JSON.stringify(envois));
}

// ================= 3) « OnlyChat recalcule » ne doit pas passer pour un chiffre sur
{
  const bloc = morceau("function tgIncertain(){", "function tgBandeau(){");
  const f=(calcul, fails, data, tgrev)=> new Function("TOKEN","ONLYCHAT_DATA","ONLYCHAT_FAILS","ONLYCHAT_CALCUL","TGREV","tgMonthKey",
      bloc+"; return tgIncertain;")("j", data, fails, calcul, tgrev||[], (ts)=>"2026-09")();
  V("recalcul sans chiffre = incertain (bandeau rouge)", f(true,0,null)===true,
    "aucun bandeau : tout le Telegram du mois compte pour 0, presente comme certain");
  V("chiffre lu = pas d'alerte", f(false,0,{totalRevenue:1200})===false, "faux positif");
  V("3 pannes d'affilee = incertain", f(false,3,null)===true, "la panne n'alerte plus");
  V("saisie manuelle presente = pas d'alerte", f(true,0,null,[{ts:0,amount:900}])===false, "faux positif malgre une saisie manuelle");
}


// ================= 4) vue associe : on ne frappe plus a une porte fermee
{
  const i = src.indexOf("var brut = window.fetch.bind(window);");
  if(i < 0) throw new Error("le filtre des routes refusees est ABSENT de ce fichier");
  const deb = src.lastIndexOf("(function(){", i);
  const fin = src.indexOf("})();", i) + 5;
  const bloc = src.slice(deb, fin);

  let appels = [];
  const faux = { fetch: (u,o)=>{ appels.push(((o&&o.method)||"GET")+" "+u);
      // le cerveau refuse les routes d argent a un compte associe
      const interdit = /(onlymonster|payments|onlychat|cash)/.test(String(u));
      // Le cerveau dit TOUJOURS « pour ce compte » sur un refus de role.
      return Promise.resolve(new Response(interdit?'{"error":"non autorise pour ce compte"}':"{}",
        {status: interdit?403:200})); } };
  new Function("window","Response", bloc)(faux, Response);

  // trois tours de boucle de 60 s, comme une page laissee ouverte
  for(let tour=0; tour<3; tour++){
    for(const r of ["/api/hub/onlymonster","/api/hub/payments","/api/hub/onlychat","/api/hub/cash","/api/hub/ghosts"]){
      await faux.fetch("https://cerveau"+r);
    }
  }
  const refuses = appels.filter(a=>/(onlymonster|payments|onlychat|cash)/.test(a)).length;
  const permis  = appels.filter(a=>/ghosts/.test(a)).length;
  V("un refus n est demande QU UNE FOIS (sinon le limiteur du cerveau coupe tout)",
    refuses===4, refuses+" appels refuses partis au lieu de 4 : a 8 par minute, le limiteur (25/15 min) coupe la page de l associee en ~3 min");
  V("ce qu elle a le droit de voir passe toujours", permis===3, permis+" appels au lieu de 3");

  // ⚠️ Un 403 qui ne vient PAS du controle de role (pare-feu, passerelle) est
  // PASSAGER : le memoriser eteindrait un panneau pour toute la session.
  {
    let n = 0;
    const passager = { fetch: (u,o)=>{ n++; return Promise.resolve(new Response("blocked by gateway", {status:403})); } };
    new Function("window","Response", bloc)(passager, Response);
    for(let k=0;k<3;k++) await passager.fetch("https://cerveau/api/hub/onlymonster");
    V("un 403 passager n est PAS memorise (sinon un hoquet eteint un panneau pour la session)",
      n===3, "seulement "+n+" appels : le panneau a ete condamne sur un incident passager");
  }

  // un POST refuse ne doit pas condamner le GET du meme chemin
  appels=[];
  await faux.fetch("https://cerveau/api/hub/tasks", {method:"POST"});
  const r2 = await faux.fetch("https://cerveau/api/hub/tasks");
  V("un POST refuse n interdit pas le GET du meme chemin", appels.length===2, "le GET a ete etouffe par le refus du POST");
}


// ================= 5) « Ton socle » : le detail doit ADDITIONNER le total
// (une addition « juste par construction » m a deja trompe : on la mesure)
{
  const d = "const netTot=Math.round(net);";
  const f = "if(_p.length){ const k=_p[0][0]; if(k===";
  const i = src.indexOf(d); if(i<0) throw new Error("bloc du socle absent");
  const j = src.indexOf("}", src.indexOf(f, i)) ;
  const bloc = src.slice(i, src.indexOf("}", j+1)+1) + "; return {netTot,nHors,nAnc,nDorm};";
  const calc = new Function("net","netRate","hors","anc","dormant", bloc);

  const TAUX = 0.8;
  let faux = 0, cas = 0, exemple = null;
  const tirage = (n)=>Math.round(Math.random()*n*100)/100;
  for(let k=0; k<200000; k++){
    const hors = Math.random()<0.15 ? 0 : tirage(4000);
    const anc  = Math.random()<0.25 ? 0 : tirage(3000);
    const dorm = Math.random()<0.30 ? 0 : tirage(9000);
    const brut = hors+anc+dorm; if(!(brut>0)) continue;
    cas++;
    const r = calc(brut*TAUX, ()=>TAUX, hors, anc, dorm);
    const somme = (hors?r.nHors:0)+(anc?r.nAnc:0)+(dorm>0?r.nDorm:0);
    if(somme !== r.netTot){ faux++; if(!exemple) exemple={hors,anc,dorm,somme,total:r.netTot}; }
  }
  V("le detail du socle additionne EXACTEMENT le total affiche ("+cas+" tirages)",
    faux===0, faux+" cas faux, ex. "+JSON.stringify(exemple));
}


// ================= 6) une alerte au seuil illisible ne doit pas etre CREEE
// (une alerte posee qui ne peut jamais se declencher est pire que pas d alerte :
//  on croit etre prevenu et on ne l est pas)
{
  const blocLM = morceau("function lireMontant(txt, opts) {", "function alerteVersementIncertain(");
  const bloc = morceau("function addRule(){", "function checkRules(){");
  const METRICS = [{k:"ca_mois",label:"CA du mois",unit:"$",bool:false},
                   {k:"proxy_mort",label:"Proxy en panne",bool:true}];
  let RULES, toasts, sauve;
  const champs = {};
  const faux$ = (sel)=>({ value: champs[sel.replace("#","")] });
  const faire = (metric, seuil)=>{
    RULES=[]; toasts=[]; sauve=0;
    champs.ruleMetric=metric; champs.ruleOp="<"; champs.ruleVal=seuil; champs.ruleLabelInput="";
    const f = new Function("RULE_METRICS","RULES","$","saveRules","renderRules","toast","tkId","lireMontant","ESPACES",
      blocLM + ";" + bloc + "; return addRule;")
      (METRICS, RULES, faux$, ()=>{sauve++;}, ()=>{}, (a,b)=>toasts.push(a+" "+b), ()=>"id1", null, /[\s  ]/g);
    f();
    return { regle: RULES[0], toasts, sauve };
  };
  let r = faire("ca_mois", "5 000");         // clavier FR : espace insecable ou non
  V("« 5 000 » ne devient pas un seuil de 0", !r.regle || r.regle.value===5000,
    "regle creee avec le seuil "+JSON.stringify(r.regle && r.regle.value)+" : elle ne se declencherait JAMAIS");
  r = faire("ca_mois", "cinq mille");
  V("un seuil illisible ne cree PAS d alerte", !r.regle, "alerte creee au seuil "+JSON.stringify(r.regle && r.regle.value));
  V("et on le dit", r.toasts.length>0, "aucun message : on croit l alerte posee");
  r = faire("ca_mois", "");
  V("un seuil VIDE ne cree pas d alerte muette", !r.regle, "alerte creee sans seuil");
  r = faire("ca_mois", "5000");
  V("un seuil normal passe toujours", !!r.regle && r.regle.value===5000, "seuil = "+JSON.stringify(r.regle && r.regle.value));
  r = faire("proxy_mort", "");
  V("une alerte OUI/NON n a pas besoin de seuil", !!r.regle, "l alerte booleenne a ete refusee a tort");
}


// ================= 7) migration des dates : ne RIEN perdre
// Ce panneau n existait que dans le navigateur. En le passant cote serveur, le
// premier chargement trouve un serveur VIDE et un appareil qui a tout
// l historique — c est la situation de TOUS les appareils au moment du
// deploiement. Ecraser reviendrait a supprimer les dates qu Andre croyait
// sauvegardees. On verifie que c est bien l inverse qui se produit.
{
  const bloc = morceau("let DATES_LOADED=false, DATES_DIRTY=false;", "function dtNextOccurrence");
  const noms = ["TOKEN","HUB_BASE","localStorage","fetch","toast","renderDates","renderCal","_depart"];
  const faire = async (serveur, local) => {
    let envois = [];
    const dec = {
      TOKEN:"j", HUB_BASE:"http://x",
      localStorage:{_d:{},setItem(){},getItem(){return null;}},
      fetch:(u,o)=>{ if(o&&o.method==="POST"){ envois.push(JSON.parse(o.body)); return Promise.resolve({ok:true}); }
                     return Promise.resolve({ok:true, json:async()=>({dates:serveur})}); },
      toast:()=>{}, renderDates:()=>{}, renderCal:()=>{}, _depart:local,
    };
    const api = new Function(...noms, "let DATES=_depart;"+bloc+
      "; return {loadDates, saveDates, get DATES(){return DATES;}};")
      (...noms.map(n=>n==="fetch"?((u,o)=>dec.fetch(u,o)):dec[n]));
    await api.loadDates();
    await new Promise(r=>setTimeout(r,5));
    return { dates: api.DATES, envois };
  };

  const r1 = await faire([], [{id:"a",text:"Anniv Welzy",date:"2026-10-01",yearly:true}]);
  V("premier chargement : ce qui n existait que sur l appareil est GARDE",
    r1.dates.length===1 && r1.dates[0].id==="a",
    "la date locale a disparu : ce commit aurait efface l historique d Andre");
  V("... et remonte au serveur",
    r1.envois.length===1 && (r1.envois[0].dates||[]).some(d=>d.id==="a"),
    "rien n a ete pousse : la date resterait locale pour toujours");
  V("l anniversaire garde son caractere annuel",
    (r1.envois[0].dates||[])[0].chaqueAnnee===true, "chaqueAnnee perdu a l aller");

  const r2 = await faire([{id:"s1",texte:"RDV compta",date:"2026-11-05",chaqueAnnee:false}], []);
  V("ce que le serveur a arrive bien sur un appareil neuf",
    r2.dates.length===1 && r2.dates[0].text==="RDV compta", JSON.stringify(r2.dates));
  V("et rien n est repousse inutilement", r2.envois.length===0, "POST parasite");

  const r3 = await faire([{id:"s1",texte:"RDV compta",date:"2026-11-05",chaqueAnnee:false}],
                         [{id:"a",text:"Anniv Welzy",date:"2026-10-01",yearly:true}]);
  V("les deux cotes fusionnent, aucun ne gagne contre l autre",
    r3.dates.length===2 && r3.dates.some(d=>d.id==="s1") && r3.dates.some(d=>d.id==="a"),
    JSON.stringify(r3.dates.map(d=>d.id)));
}


// ================= 8) les primes reellement versees entrent dans le profit
// Le compte de resultat deduisait un cout VA THEORIQUE (abonnes x tarif). Les
// primes, la part manager et la part team leader reellement versees n entraient
// dans AUCUN calcul : le profit affiche etait plus haut que la realite, et le
// partage entre associes avec.
{
  const bloc = morceau("function primesVerseesCeMois(){", "function moneyPrecis(");
  const faire = (hist, mk) => new Function("PCUMUL_HIST","tgMonthKey", bloc + "; return primesVerseesCeMois;")(hist, mk)();
  const MK = (ts) => new Date(ts).toISOString().slice(0,7);
  const now = Date.now(), moisDernier = now - 40*86400000;

  const r = faire([
    { va:"Welzy", subsPay:400, prime:150, manager:0,  leader:0,  ts: now },
    { va:"Yohan", subsPay:300, prime:0,   manager:75, leader:50, ts: now },
    { va:"Prince",subsPay:200, prime:900, manager:0,  leader:0,  ts: moisDernier },   // AUTRE mois
  ], MK);
  V("seules les primes du MOIS EN COURS comptent", r.total===275,
    "total="+r.total+" (attendu 275 : 150 + 75 + 50 ; les 900 du mois dernier ne comptent pas)");
  V("le detail est ventile", r.prime===150 && r.manager===75 && r.leader===50,
    JSON.stringify(r));

  // ⚠️ Le controle qui compte le plus : journal pas encore lu.
  V("journal absent = null, PAS zero",
    faire(null, MK)===null,
    "un 0 voudrait dire « aucune prime versee ce mois » — la conclusion la plus fausse possible");

  // Aucun versement ce mois : la, zero est la VERITE, pas une ignorance.
  const vide = faire([{ va:"X", prime:900, manager:0, leader:0, ts: moisDernier }], MK);
  V("aucun versement ce mois = 0, et c est juste", vide && vide.total===0, JSON.stringify(vide));

  // Journal plafonne a 200 lignes cote serveur : le total peut etre un minimum.
  const plein = Array.from({length:200}, (_,i)=>({ va:"V"+i, prime:1, manager:0, leader:0, ts: now }));
  const tr = faire(plein, MK);
  V("un journal tronque est SIGNALE au lieu d etre affirme", tr && tr.tronque===true,
    "sans ce drapeau, un total sous-estime passerait pour exact");
}

console.log(ko? "\n"+ko+" ECHEC(S)" : "\nTOUT PASSE"); process.exit(ko?1:0);
