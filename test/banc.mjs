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
  m.payVa("Nael", 150);                             // l'operateur clique a t=10ms
  const apresClic = m.isPaid("Nael");
  await lecture; await new Promise(r=>setTimeout(r,80));
  verifie("le clic Payer survit a une lecture deja en vol",
    apresClic && m.isPaid("Nael"),
    "Nael est redevenu 'a payer' -> second clic -> DOUBLE PAIEMENT (paye="+m.isPaid("Nael")+")");
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
  m.payVa("Nael",150);
  await l; await new Promise(r=>setTimeout(r,80));
  verifie("le serveur a bien recu le paiement", reseau.includes("POST"), "aucun POST : la paie n'existerait que sur cet ecran");
}


// ================= 1) objectif par VA : une faute de frappe ne doit rien effacer
{
  const bloc = morceau("function setVaGoal(va){", "// 🪄 Appliquer les objectifs");
  let VA_GOALS={Nael:40}, sauve=0, toasts=[];
  const f = new Function("VA_GOALS","prompt","suggestVaGoal","saveVaGoals","toast","OM_DATA","renderOM",
    bloc + "; return setVaGoal;");
  const faire = (saisie)=>{ toasts=[]; return f(VA_GOALS, ()=>saisie, ()=>null, ()=>{sauve++;}, (a,b)=>toasts.push(a), null, ()=>{})("Nael"); };

  faire("5o");   // lettre o au lieu du zero
  V("« 5o » ne SUPPRIME pas l'objectif", VA_GOALS.Nael===40, "objectif devenu "+JSON.stringify(VA_GOALS.Nael)+" (il valait 40)");
  V("et l'operateur est prevenu", toasts.length>0, "aucun message : la disparition est silencieuse");
  faire("50 subs");
  V("« 50 subs » ne supprime pas non plus", VA_GOALS.Nael===40, "objectif devenu "+JSON.stringify(VA_GOALS.Nael));
  faire("50");
  V("un vrai nombre passe toujours", VA_GOALS.Nael===50, "objectif = "+JSON.stringify(VA_GOALS.Nael));
  faire("");
  V("vider le champ retire bien l'objectif (geste explicite)", VA_GOALS.Nael===undefined, "reste "+JSON.stringify(VA_GOALS.Nael));
  VA_GOALS.Nael=40; faire("0");
  V("taper 0 retire bien l'objectif", VA_GOALS.Nael===undefined, "reste "+JSON.stringify(VA_GOALS.Nael));
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

  const r1 = await faire([], [{id:"a",text:"Anniv Nael",date:"2026-10-01",yearly:true}]);
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
                         [{id:"a",text:"Anniv Nael",date:"2026-10-01",yearly:true}]);
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
    { va:"Nael", subsPay:400, prime:150, manager:0,  leader:0,  ts: now },
    { va:"Sacha", subsPay:300, prime:0,   manager:75, leader:50, ts: now },
    { va:"Milo",subsPay:200, prime:900, manager:0,  leader:0,  ts: moisDernier },   // AUTRE mois
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


// ================= 9) « a payer » : trois ecrans, et aucun le vrai montant
// La tuile d en-tete, la ligne d observation et l ecran du matin affichaient
// tous `aPayer` (vue quinzaine : subs x tarif). Le montant qu Andre sort
// vraiment du compte est celui de « Paie au cumul », qui tient compte de ce
// qui a deja ete verse. Apres une paie de milieu de quinzaine, les deux vont
// du simple au double.
{
  const bloc = morceau("function duReellement(){", "function primesVerseesCeMois(");
  const faire = (PCUMUL) => new Function("PCUMUL", bloc + "; return duReellement;")(PCUMUL)();

  const base = { total: 850, primesTotal: 0, vas: [
    { va:"Nael",  base: 1200, nouveaux: 40, aPayer: 500 },
    { va:"Sacha",  base: 900,  nouveaux: 28, aPayer: 350 },
    { va:"Bot",    base: null, nouveaux: 0,  aPayer: 0, unpaid: true },   // perso : jamais paye
  ]};
  const r = faire(base);
  V("le vrai montant du remonte en une du tableau de bord", r && r.total===850, JSON.stringify(r));
  V("le compte perso n est pas compte comme un VA a payer", r && r.nbVa===2, "nbVa="+(r&&r.nbVa));
  V("sans VA orphelin, le total n est pas annonce comme un plancher", r && r.plancher===false, JSON.stringify(r));

  // ⚠️ Le controle qui compte : cote serveur, un VA sans repere de paie vaut
  // EXACTEMENT 0 dans le total. La verite est « je ne sais pas ». Annoncer 850
  // comme un montant ferme, c est preparer 850 et en devoir davantage.
  const orphelin = faire(Object.assign({}, base, { vas: base.vas.concat([{ va:"Milo", base:null, nouveaux:60, aPayer:0 }]) }));
  V("un VA sans repere de paie transforme le total en PLANCHER",
    orphelin && orphelin.plancher===true && orphelin.sansBase===1,
    "sans ce drapeau la tuile affiche un montant ferme qui est faux : "+JSON.stringify(orphelin));

  // « absent != 0 » : rien de charge => rien a dire, surement pas « 0 $ a payer ».
  V("tableau non charge = null, PAS zero", faire(null)===null, "un 0 voudrait dire « tu ne dois rien »");
  V("tableau vide = null aussi", faire({ total:0, vas:[] })===null, "0 VA ne veut pas dire 0 du");
  V("un total illisible ne devient pas 0", faire({ total:"n/a", vas:base.vas })===null, "NaN affiche en dur");

  // Les primes Discord ne sont PAS dans le total : il faut le dire, pas l ignorer.
  const avecPrimes = faire(Object.assign({}, base, { primesTotal: 120 }));
  V("les primes non reglees sont signalees a part du total", avecPrimes && avecPrimes.primes===120, JSON.stringify(avecPrimes));
  const primesKo = faire(Object.assign({}, base, { primesTotal: null, primesKo: true }));
  V("primes illisibles = null, pas 0", primesKo && primesKo.primes===null, JSON.stringify(primesKo));

  // Un tableau perime ne doit pas passer pour frais : c est sur ce chiffre qu on paie.
  const vieux = faire(Object.assign({}, base, { _perime: true }));
  V("un tableau perime est marque comme tel", vieux && vieux.perime===true, JSON.stringify(vieux));
}


// ================= 10) un radar qui ne peut pas dire « je n ai pas regarde »
// `loadDecroche` echouait en silence : pas de rendu, DECROCHE_FLAGS restait le
// tableau vide du depart, et la file d actions n affichait AUCUNE ligne. Pas de
// ligne se lit « aucun VA ne decroche » — l inverse de la verite. Trois
// detecteurs vivent sur cette source : decrochage, decollages, anomalies.
{
  const bloc = morceau("function vaqzMesure(){", "function renderDecroche(");
  const faire = (etat, data) => new Function("VAQZ_ETAT","VAQZ_DATA", bloc + "; return vaqzMesure;")(etat, data)();

  V("avant toute tentative, on ne crie pas", faire(null, null)===null,
    "une alerte des le premier pixel = du bruit, et le bruit se desapprend");

  // ⚠️ LE CONTROLE QUI COMPTE : mesure ratee, rien en reserve.
  const ko = faire({ok:false, raison:"le serveur a repondu 500"}, null);
  V("une mesure ratee est AVOUEE, pas tue", ko && ko.mesure===false,
    "sans ca, le panneau se cache et le silence passe pour « tout va bien »");
  V("et le motif suit", ko && /500/.test(ko.raison||""), JSON.stringify(ko));

  const ok = faire({ok:true}, {parVa:{Nael:[10,8,4]}, labels:["a","b","c"]});
  V("une vraie mesure reste une vraie mesure", ok && ok.mesure===true && ok.perime===false, JSON.stringify(ok));

  // Cas piege : ca a marche tout a l heure, la derniere tentative a echoue.
  // On garde les chiffres (mieux que rien) sans les faire passer pour frais.
  const vieux = faire({ok:false, raison:"pas de reseau"},
                      {parVa:{Nael:[10,8,4]}, labels:["a","b","c"], _perime:true});
  V("des chiffres gardes apres un echec sont marques perimes",
    vieux && vieux.mesure===true && vieux.perime===true, JSON.stringify(vieux));
  V("... mais on n efface pas ce qu on sait deja",
    vieux && vieux.mesure===true, "tout jeter serait aussi faux que tout affirmer");
}


// ================= 11) la facture Railway n entrait dans aucun profit
// `coutOutils` n additionne que la liste tapee a la main. Railway a son propre
// panneau et son propre reglage, et ne descendait ni dans le compte de resultat
// ni dans le partage avec l associee. Deux pieges a eviter en le corrigeant :
// le compter DEUX fois (s il est deja dans la liste), et deduire une ESTIMATION
// comme si c etait une facture.
{
  const bloc = morceau("function coutRailwayMois(){", "function duReellement(");
  const faire = (RW_DATA, COSTS) => new Function("RW_DATA","COSTS","coutMensuel",
    bloc + "; return coutRailwayMois;")(RW_DATA, COSTS, (c)=>Number(c&&c.m)||0)();

  const facture = { total: 240, factureSaisie: true, projets: [{}] };

  const r = faire(facture, []);
  V("une facture SAISIE est deduite du profit", r && r.aAjouter===240, JSON.stringify(r));

  // LE CONTROLE QUI COMPTE #1 : deja tape a la main dans les depenses d outils.
  const dbl = faire(facture, [{ n: "Railway", m: 240 }]);
  V("deja dans les depenses d outils : on n ajoute RIEN", dbl && dbl.aAjouter===0,
    "sinon la facture est comptee DEUX fois et le profit tombe de 240 $ pour rien");
  V("... et on le dit", dbl && dbl.dansLaListe===true, JSON.stringify(dbl));

  // Ecart entre ce qu il a tape et la vraie facture : on le signale.
  const ecart = faire(facture, [{ n: "railway prod", m: 100 }]);
  V("un montant tape loin de la vraie facture est signale", ecart && ecart.ecart===140,
    "ecart=" + (ecart && ecart.ecart));

  // LE CONTROLE QUI COMPTE #2 : sans facture saisie, `total` est une ESTIMATION
  // (le serveur a mesure un meme projet a 10,08 $ puis 0,72 $ en une heure).
  // La deduire fabriquerait un faux precis dans le partage entre associes.
  const estim = faire({ total: 190, factureSaisie: false, projets: [{}] }, []);
  V("une estimation n est PAS deduite du profit", estim && estim.aAjouter===0,
    "deduire une estimation = un faux precis dans le partage d associes");
  V("... et l ecran doit dire que le profit est trop haut", estim && estim.manquant===true,
    "sans ce drapeau, l absence de ligne se lit « Railway ne coute rien »");

  // « absent != 0 » : panneau pas charge = rien a dire.
  V("panneau Railway non charge = null, PAS zero", faire(null, [])===null,
    "un 0 voudrait dire « Railway est gratuit »");
  V("un total illisible ne devient pas un montant",
    (faire({ total: "n/a", factureSaisie: true, projets: [{}] }, [])||{}).montant===null, "NaN affiche en dur");
}


// ================= 12) la pastille « nouvelle version » etait INERTE
// Elle n etait accrochee qu a `controllerchange`, qui n arrive que si sw.js
// change d octets. index.html part plusieurs fois par jour, sw.js jamais : la
// pastille ne pouvait pas s allumer, et eteinte elle se lit « tu es a jour ».
// On surveille maintenant la signature (ETag) de la page.
{
  const bloc = morceau("var _signaturePage=null;", "function proposerMaj(");
  const monter = (reponses) => {
    let i = 0, proposees = 0;
    const fetchFaux = async () => {
      const r = reponses[Math.min(i++, reponses.length - 1)];
      if (r === "reseau") throw new Error("hors ligne");
      return { ok: r.ok !== false, headers: { get: (k) => (r[String(k).toLowerCase()] || null) } };
    };
    const f = new Function("fetch", "proposerMaj",
      bloc + "; return { v: verifierVersionPage, n: () => _signaturePage };")(fetchFaux, () => { proposees++; });
    return { ...f, combien: () => proposees };
  };

  const E = (t) => ({ etag: t });

  const a = monter([E('"aaa"'), E('"aaa"')]);
  await a.v(); await a.v();
  V("meme version : aucune pastille", a.combien()===0, "propositions=" + a.combien());
  V("la premiere mesure sert de repere, elle n alerte pas", a.n()==='"aaa"', String(a.n()));

  const b = monter([E('"aaa"'), E('"bbb"')]);
  await b.v(); await b.v();
  V("une mise en ligne allume la pastille", b.combien()===1, "propositions=" + b.combien());

  // ⚠️ LE CONTROLE QUI COMPTE : pas de signature du tout. Une pastille qui
  // s allume au hasard se fait ignorer en deux jours — et le jour ou elle a
  // raison, personne ne clique.
  const c = monter([{}, {}]);
  await c.v(); await c.v();
  V("sans signature, on ne conclut RIEN", c.combien()===0, "propositions=" + c.combien());

  // A defaut d ETag, la date de derniere modification fait l affaire.
  const d = monter([{ "last-modified": "lun" }, { "last-modified": "mar" }]);
  await d.v(); await d.v();
  V("la date de modification sert de repli", d.combien()===1, "propositions=" + d.combien());

  const e = monter(["reseau", "reseau"]);
  await e.v(); await e.v();
  V("une coupure reseau n allume rien et ne casse rien", e.combien()===0, "propositions=" + e.combien());

  const f = monter([{ ok: false }, { ok: false }]);
  await f.v(); await f.v();
  V("une reponse en erreur n allume rien", f.combien()===0, "propositions=" + f.combien());
}


// ================= 13) ce qui va s arreter tout seul, sans le taper
// Le panneau ne connaissait que les dates saisies a la main -- donc rien. Trois
// choses qui coupent le robinet sont deja mesurees ailleurs dans la page.
{
  const bloc = morceau("function echeancesMesurees(){", "function renderEcheances(");
  const faire = (LAST, COOKIE_DATA) => new Function("LAST","COOKIE_DATA","fmtMoney",
    bloc + "; return echeancesMesurees;")(LAST, COOKIE_DATA, (v)=>v+" $")();

  const L = {
    "proxy-solde":    { metrics: { jours: 12, go: 45.23 } },
    "onlychat-solde": { metrics: { jours: 8,  solde: 42 } },
  };
  const r = faire(L, { jours: 3, expire_le: "2026-09-12" });
  const par = Object.fromEntries(r.map(x => [x.cle, x]));

  V("les trois sources sont toujours listees", r.length===3, "recu " + r.length);
  V("le cookie est une VRAIE date", par.cookie.exact===true && par.cookie.date==="2026-09-12", JSON.stringify(par.cookie));
  V("le proxy est une ESTIMATION, et c est dit", par.proxy.exact===false && par.proxy.j.n===12, JSON.stringify(par.proxy));
  V("le reste de data est repris tel quel", par.proxy.reste==="45,2 Go", par.proxy.reste);
  V("le solde OnlyChat suit la meme regle", par.onlychat.exact===false && par.onlychat.j.n===8, JSON.stringify(par.onlychat));

  // ⚠️ LE CONTROLE QUI COMPTE #1 : « >30 » veut dire « AU MOINS 30 j ».
  // Le serveur borne l horizon a 30x la duree observee. Lire 30 tout court, ce
  // serait refaire le « ~202 j » extrapole de 8 h qui avait failli passer pour
  // une certitude.
  const mini = faire({ "proxy-solde": { metrics: { jours: ">30", go: 400 } } }, null);
  const pm = mini.find(x => x.cle==="proxy");
  V("un horizon borne est lu comme un MINIMUM", pm.j.n===30 && pm.j.mini===true, JSON.stringify(pm.j));

  // ⚠️ LE CONTROLE QUI COMPTE #2 : rien de mesure. Faire disparaitre la ligne,
  // dans un panneau qui repond a « qu est-ce qui va s arreter ? », se lirait
  // « rien a signaler ».
  const vide = faire(null, null);
  V("sans aucune mesure, les lignes restent la", vide.length===3, "recu " + vide.length);
  V("... et disent « je ne sais pas », pas « tout va bien »",
    vide.every(x => x.j===null), JSON.stringify(vide.map(x => x.j)));

  // Une valeur illisible ne doit pas devenir un nombre de jours.
  const sale = faire({ "proxy-solde": { metrics: { jours: "bientot" } } }, null);
  V("une mesure illisible ne devient pas une echeance",
    sale.find(x => x.cle==="proxy").j===null, "un texte libre ne doit pas etre lu comme des jours");

  // Un depassement doit rester lisible en negatif, pas etre efface.
  const perime = faire(null, { jours: -4, expire_le: "2026-09-01" });
  V("une echeance deja depassee est gardee", perime.find(x=>x.cle==="cookie").j.n===-4, "cookie expire efface");
}


// ================= 14) quel modele est le moins cher a faire grandir
// La ligne des modeles montrait une marge, mais en TOTAL : le plus gros gagne
// toujours et la comparaison ne dit rien. Normalisee par abonne, elle repond.
{
  const bloc = morceau("function margeParAbonne(", "function coutRailwayMois(");
  const f = new Function(bloc + "; return margeParAbonne;")();

  V("marge par abonne = marge / abonnes PAYES", f({ marge: 600, subsPayes: 400 })===1.5,
    String(f({ marge: 600, subsPayes: 400 })));
  V("une marge negative reste negative", f({ marge: -120, subsPayes: 300 })===-0.4,
    String(f({ marge: -120, subsPayes: 300 })));

  // ⚠️ LE CONTROLE QUI COMPTE : le mauvais denominateur. `subs` compte AUSSI les
  // comptes perso, jamais remuneres ; la marge, elle, ne les facture pas.
  // Diviser par `subs` donnerait un chiffre qui a l air precis et qui est faux.
  V("sans le denominateur payes, on ne calcule RIEN",
    f({ marge: 600, subs: 400 })===null,
    "on a divise par « subs » : deux denominateurs melanges dans le meme chiffre");

  // « absent != 0 » des deux cotes.
  V("marge non mesuree = null, pas 0", f({ marge: null, subsPayes: 400 })===null, "0 se lirait « ce modele ne rapporte rien »");
  V("aucun abonne paye = null (pas une division par zero)", f({ marge: 600, subsPayes: 0 })===null, String(f({ marge: 600, subsPayes: 0 })));
  V("entree vide = null", f(null)===null && f({})===null, "une carte vide ne doit pas produire un chiffre");

  // Une marge de zero EST une mesure : elle doit sortir 0, pas null.
  V("une marge reellement nulle vaut 0, et le dit", f({ marge: 0, subsPayes: 200 })===0, String(f({ marge: 0, subsPayes: 200 })));
}


// ================= 15) raccourcis et routines : ne plus mourir avec le cache
// C etaient les deux dernieres listes tapees a la main qui n appelaient AUCUN
// serveur : aucune cle en base, donc absentes de l export manuel ET de la
// sauvegarde de 4h30. Vider le cache du telephone les effacait pour de bon.
{
  const bloc = morceau("let LISTES_LUES=false", "function pousserListes(");
  const monter = (reponse, locaux) => {
    const pousses = [];
    let SHORTCUTS = (locaux && locaux.shortcuts) || [];
    let ROUTINES  = (locaux && locaux.routines) || [];
    const store = {};
    const fetchFaux = async () => {
      if (reponse === "ko") return { ok: false };
      if (reponse === "reseau") throw new Error("hors ligne");
      return { ok: true, json: async () => reponse };
    };
    const f = new Function("TOKEN","HUB_BASE","fetch","SHORTCUTS","ROUTINES",
      "localStorage","pousserListes","renderShortcuts","renderRoutines",
      bloc + "; return { charger: loadListesPerso, lues: () => LISTES_LUES, S: () => SHORTCUTS, R: () => ROUTINES };")(
      "jeton", "http://x", fetchFaux, SHORTCUTS, ROUTINES,
      { setItem: (k, v) => { store[k] = v; }, getItem: (k) => store[k] || null },
      (q) => pousses.push(q), () => {}, () => {});
    return Object.assign(f, { pousses, store });
  };

  // Appareil neuf : le serveur a tout, l appareil n a rien.
  const a = monter({ shortcuts: [{ n: "OnlyMonster", u: "https://om" }], routines: [{ name: "Matin" }] }, null);
  await a.charger();
  V("ce que le serveur a arrive sur un appareil neuf",
    a.S().length===1 && a.S()[0].n==="OnlyMonster" && a.R().length===1, JSON.stringify(a.S()));
  V("et rien n est repousse inutilement", a.pousses.length===0, JSON.stringify(a.pousses));

  // ⚠️ LE CONTROLE QUI COMPTE : premier chargement, le serveur est VIDE et
  // l appareil a tout. Ecraser ici, c est effacer des mois de raccourcis.
  const b = monter({ shortcuts: [], routines: [] },
                   { shortcuts: [{ n: "Infloww", u: "https://i" }], routines: [{ name: "Soir" }] });
  await b.charger();
  V("ce qui n existait que sur l appareil est GARDE",
    b.S().length===1 && b.S()[0].n==="Infloww", JSON.stringify(b.S()));
  V("... et remonte au serveur", b.pousses.some(q => q && q.shortcuts), JSON.stringify(b.pousses));
  V("les routines suivent la meme regle",
    b.R().length===1 && b.pousses.some(q => q && q.routines), JSON.stringify(b.pousses));

  // Les deux cotes fusionnent, aucun ne gagne contre l autre.
  const c = monter({ shortcuts: [{ n: "OnlyMonster", u: "https://om" }], routines: [] },
                   { shortcuts: [{ n: "Infloww", u: "https://i" }], routines: [] });
  await c.charger();
  V("les deux cotes fusionnent", c.S().length===2, JSON.stringify(c.S().map(x=>x.n)));
  V("aucun doublon quand la meme entree est des deux cotes",
    (await (async () => { const d = monter({ shortcuts:[{n:"Infloww",u:"https://i"}], routines:[] },
                                           { shortcuts:[{n:"Infloww",u:"https://i"}], routines:[] });
      await d.charger(); return d.S().length; })())===1, "le raccourci a ete duplique a chaque ouverture");

  // ⚠️ LECTURE RATEE : on n ecrira RIEN. Sinon la premiere modification sur cet
  // appareil effacerait la liste du serveur.
  const e = monter("ko", { shortcuts: [{ n: "Local", u: "https://l" }], routines: [] });
  await e.charger();
  V("serveur muet : la liste locale est intacte", e.S().length===1 && e.S()[0].n==="Local", JSON.stringify(e.S()));
  V("serveur muet : on ne se declare PAS pret a ecrire", e.lues()===false,
    "ecrire sur une lecture ratee efface la liste du serveur");

  const g = monter("reseau", { shortcuts: [{ n: "Local", u: "https://l" }], routines: [] });
  await g.charger();
  V("coupure reseau : idem, rien n est perdu ni ecrase", g.S().length===1 && g.lues()===false, JSON.stringify(g.S()));
}


// ================= 16) une alerte qui ne dit pas ou on en est
// La ligne affichait la REGLE et une pastille. La valeur du moment etait deja
// calculee deux lignes plus haut, pour choisir la couleur, puis jetee. Le seul
// indice sur l etat ⚪ etait un `title=` : un survol, invisible au doigt.
{
  const bloc = morceau("function ruleEtat(r){", "function ruleLabel(");
  const faire = (regle, valeur) => new Function("RULE_METRICS","ruleMetricVal","fmtInt",
    bloc + "; return ruleEtat;")(
      [{k:"ca_mois",label:"CA brut du mois",unit:"$",bool:false},
       {k:"proxy_mort",label:"Proxy en panne",bool:true}],
      () => valeur, (n) => String(Math.round(n)))(regle);

  const r1 = faire({ metric:"ca_mois", op:">", value:20000 }, 4180);
  V("la ligne dit ou on en est aujourd hui", /4180/.test(r1), r1);
  V("... et ce qu il manque pour que ca sonne", /15820/.test(r1), r1);

  const r2 = faire({ metric:"ca_mois", op:">", value:20000 }, 24000);
  V("un seuil franchi est annonce comme tel", /franchi/.test(r2), r2);

  const r3 = faire({ metric:"ca_mois", op:"<", value:500 }, 3000);
  V("un seuil vers le BAS parle de marge, pas de manque", /marge/.test(r3) && /2500/.test(r3), r3);

  // ⚠️ LE CONTROLE QUI COMPTE : source muette. Ecrire « aujourd hui 0 $ »
  // ferait croire a un effondrement du chiffre d affaires.
  const r4 = faire({ metric:"ca_mois", op:">", value:20000 }, undefined);
  V("une mesure non recue se dit, elle ne devient pas 0", /non re/.test(r4) && !/0 \$/.test(r4), r4);

  const r5 = faire({ metric:"proxy_mort", op:">", value:0 }, 1);
  V("une alerte oui/non affiche oui ou non", /oui/.test(r5), r5);
  const r6 = faire({ metric:"proxy_mort", op:">", value:0 }, 0);
  V("... et « non » est une VRAIE reponse, pas un vide", /non/.test(r6) && r6.length>0, r6);
}


// ================= 17) ce que l IA de vente te prend, PAR NATURE
// Le panneau disait combien elle preleve et finissait par un aveu : « ce solde
// finance l IA sur Telegram ET OnlyFans ». La source envoyait pourtant le
// `type` de chaque prelevement ; le cerveau ne gardait que date et montant.
{
  const bloc = morceau("  const natureLigne=(function(){", "  const soldeLigne=(d.solde!=null)");
  const faire = (soldeParNature) => new Function("d","tgMoney","escapeHtml",
    "const natureLigne=" + bloc.replace(/^\s*const natureLigne=/, "") + "; return natureLigne;")(
      { soldeParNature }, (v) => Math.round(Number(v)) + " $", (x) => String(x));

  const r = faire({ COMMISSION: 120, SUBSCRIPTION: 180 });
  V("le detail par nature s affiche", /COMMISSION/.test(r) && /SUBSCRIPTION/.test(r), r);
  V("le total est la somme du detail", /300 \$/.test(r), r);
  V("le plus gros poste vient en premier", r.indexOf("SUBSCRIPTION") < r.indexOf("COMMISSION"), r);

  // ⚠️ LE CONTROLE QUI COMPTE : rien de lu. Un total a 0 se lirait « l IA ne te
  // prend rien », la conclusion la plus fausse possible sur une ligne de cout.
  V("ventilation non lue = on se tait", faire(null)==="", faire(null));
  V("objet vide = on se tait aussi", faire({})==="", faire({}));

  // Un prelevement sans type reste A PART. Le fondre dans une autre categorie
  // rendrait le total juste et le detail mensonger.
  const q = faire({ COMMISSION: 100, "?": 40 });
  V("un prelevement sans type est dit comme tel", /nature non pr/.test(q), q);
  V("... et compte quand meme dans le total", /140 \$/.test(q), q);

  // Une valeur illisible ne doit pas devenir une ligne a 0.
  const z = faire({ COMMISSION: 100, BIDON: 0 });
  V("une nature a zero n encombre pas la ligne", !/BIDON/.test(z), z);
}


// ================= 18) le partage ne regardait jamais la caisse
// `renderSplit` ne contenait AUCUNE reference a la tresorerie : on repartissait
// un profit calcule sur du chiffre d affaires sans jamais verifier qu il y a
// l argent pour le sortir.
{
  const bloc = morceau("function caisseSuffit(", "function coutRailwayMois(");
  const f = new Function(bloc + "; return caisseSuffit;")();

  V("assez de caisse : rien a signaler",
    f(2000, { apresPaie: 5000 }).etat==="ok", JSON.stringify(f(2000, { apresPaie: 5000 })));

  const d = f(6000, { apresPaie: 4500 });
  V("pas assez : on previent, avec le manque", d.etat==="depasse" && d.manque===1500, JSON.stringify(d));

  // ⚠️ LE CONTROLE QUI COMPTE : tresorerie non lue. Repondre « ok » ferait
  // croire que la verification a eu lieu ; repondre « depasse » inquieterait
  // pour rien. La seule reponse juste est « je ne sais pas ».
  for (const cas of [null, { error: "boom" }, { tresoIndispo: true }, { apresPaie: null }, { apresPaie: "n/a" }]) {
    V("tresorerie illisible = « je ne sais pas » (" + JSON.stringify(cas) + ")",
      f(3000, cas).etat==="inconnu", JSON.stringify(f(3000, cas)));
  }

  // Une tresorerie PARTIELLE est un plancher : le dire, sinon on inquiete pour rien.
  V("une tresorerie partielle est signalee comme un plancher",
    f(6000, { apresPaie: 4500, tresoPartiel: true }).partiel===true, "le drapeau partiel s est perdu");

  // Rien a sortir = rien a dire : pas de bandeau parasite en debut de mois.
  V("rien a sortir : aucun message", f(0, { apresPaie: 4500 })===null, JSON.stringify(f(0, { apresPaie: 4500 })));
  V("un montant negatif ne declenche rien non plus", f(-10, { apresPaie: 4500 })===null, "un profit negatif n est pas un retrait");
}


// ================= 19) le detecteur de « mesure absente lue comme zero »
// Presque tous les bugs d argent trouves cette semaine sont le MEME : le
// cerveau envoie `null` quand il ne sait pas, la page ecrit `Number(x)||0`, et
// « je ne sais pas » devient « zero ». Un zero se lit comme une mesure.
//
// Plutot que de les chercher un par un, on relit le VRAI fichier et on exige
// que toute coercition a zero portant sur un champ que le cerveau peut envoyer
// a `null` soit ENTOUREE d une garde (revKo(), ou un test != null). Une
// nouvelle coercition non gardee fera echouer ce banc.
//
// ⚠️ Il attrape une FAMILLE de bugs, pas tous les bugs. Dit ici pour que
// personne ne le prenne pour un rejeu complet.
{
  // ⚠️ LITTÉRAL de regex, pas `new RegExp("...")` : dans une chaîne JS,
  // "\s" devient "s" et "\|" devient "|". La 1re version se transformait
  // donc en alternance de vide et signalait TOUTES les lignes du fichier.
  // Un détecteur qui trouve partout ne trouve rien.
  const motif = () => /(?:Number|parseFloat|parseInt)\(\s*([A-Za-z_$][\w$.\[\]'"]*\.(?:netMonth|netLastMonth|subsMonth|subsDay|margeMonth|apresPaie|dispo|attente|revMonth|revPeriod|ltvGlobale|ltv|roi|marge|solde|aPayer|subsQuinzaine))\s*(?:,\s*10\s*)?\)\s*\|\|\s*0/g;

  const lignes = src.split("\n");
  // Frontieres de fonctions calculees UNE fois, et garde memorisee par fonction.
  // (La premiere version relisait le corps a chaque occurrence : sur 13 000
  // lignes, Node tombait a court de memoire. Un controle qui ne tourne pas ne
  // protege rien.)
  const debuts = [];
  lignes.forEach((l, i) => { const m = /^(?:async )?function ([A-Za-z0-9_$]+)\(/.exec(l); if (m) debuts.push({ i, nom: m[1] }); });
  const gardee = new Array(debuts.length).fill(null);
  const indexFonction = (n) => { let lo = 0, hi = debuts.length - 1, r = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (debuts[mid].i <= n) { r = mid; lo = mid + 1; } else hi = mid - 1; }
    return r; };
  const aUneGarde = (k, n) => {
    if (k < 0) return false;
    if (gardee[k] === null) {
      const finF = (k + 1 < debuts.length) ? debuts[k + 1].i : lignes.length;
      const corps = lignes.slice(debuts[k].i, finF).join("\n");
      gardee[k] = corps.includes("revKo") || corps.includes("==null") || corps.includes("!=null");
    }
    return gardee[k];
  };

  const marque = new Array(debuts.length).fill(null);
  const aUnMarqueur = (k) => {
    if (k < 0) return false;
    if (marque[k] === null) {
      const finF = (k + 1 < debuts.length) ? debuts[k + 1].i : lignes.length;
      marque[k] = lignes.slice(debuts[k].i, finF).join("{B}n").includes("@zero-assume");
    }
    return marque[k];
  };
  const fuites = [], exemptes = [];
  const RE = motif();
  lignes.forEach((l, idx) => {
    if (l.indexOf("||") < 0) return;              // filtre rapide
    RE.lastIndex = 0;
    let m;
    while ((m = RE.exec(l))) {
      if (m.index === RE.lastIndex) RE.lastIndex++;   // jamais de boucle infinie
      const k = indexFonction(idx);
      if (aUneGarde(k, idx)) continue;
      // Exemption ASSUMÉE : le code porte `@zero-assume` avec sa raison.
      // ⚠️ On l'annonce a CHAQUE passage. Une exemption silencieuse survit a sa
      // raison -- c'est exactement ce qui s'est passe avec `dispensees` dans
      // test/preflight.js, qui a laisse 4 routes sans prevol pendant des mois.
      if (aUnMarqueur(k)) { exemptes.push((k >= 0 ? debuts[k].nom : "?")); continue; }
      fuites.push("L" + (idx + 1) + " " + (k >= 0 ? debuts[k].nom : "?") + " : " + m[1]);
    }
  });
  V("aucune mesure absente n est lue comme un zero", fuites.length === 0,
    "coercitions non gardees : " + fuites.join(" | "));
  // On NOMME les exemptions a chaque passage : une exemption qu on ne voit plus
  // est une exemption qui survivra a sa raison.
  V("les exemptions assumees sont au nombre attendu (" + [...new Set(exemptes)].join(", ") + ")",
    new Set(exemptes).size <= 1,
    "de nouvelles fonctions se sont exemptees : " + [...new Set(exemptes)].join(", "));

  // Un controle qu on n a jamais vu echouer ne prouve rien : on lui donne une
  // ligne fautive fabriquee, il doit la reconnaitre.
  V("... et le detecteur reconnait bien la forme qu il surveille",
    motif().test("  const x = Number(t.netMonth)||0;"),
    "le motif est devenu inerte : il ne verrait plus rien passer");
}


// ================= 20) inscrire un VA le jour de l embauche
// Un VA n existait dans ce centre qu a partir du moment ou Infloww lui
// attribuait des abonnes : impossible de noter sa date d arrivee le jour ou on
// l embauche, et impossible de voir celui qui ne demarre pas.
// L inscription ne CREE aucun VA : c est un nom et une date, jamais de l argent.
{
  const bloc = morceau("function vaProduitDeja(nom){", "function renderVaNouveaux(");
  // ⚠️ CE BLOC DEPENDAIT DE L HEURE QU IL EST. `ilYA()` fabriquait ses dates en
  // UTC, la fonction testee comparait a `Date.now()` en heure de Paris : entre
  // 22 h et minuit, « il y a 12 jours » devenait 13 et le banc rougissait tout
  // seul. Le code de production a ete corrige (il compare deux dates de
  // calendrier via `jourServeur()`), et ce banc ne regarde plus l horloge du
  // tout : on lui DONNE le jour metier. Il rend le meme verdict a 3 h comme a
  // 23 h, en ete comme en hiver.
  const AUJOURDHUI = "2026-09-12";
  const faire = (OM_DATA, VA_STARTS, VA_ARCHIVES) => new Function("OM_DATA","VA_STARTS","VA_ARCHIVES","jourServeur",
    bloc + "; return { attente: vaEnAttente, produit: vaProduitDeja };")(OM_DATA, VA_STARTS, VA_ARCHIVES, () => AUJOURDHUI);

  const JOUR = 86400000;
  const ilYA = (n) => new Date(Date.parse(AUJOURDHUI + "T00:00:00Z") - n*JOUR).toISOString().slice(0,10);

  const om = { vas: [{ va: "Nael" }, { va: "Sacha" }] };

  // Un inscrit qui n a rien produit doit ressortir, avec ses jours.
  const r = faire(om, { "Milo": ilYA(12), "Nael": ilYA(300) }, []).attente();
  V("un inscrit qui n a rien produit ressort", r.length===1 && r[0].va==="Milo", JSON.stringify(r));
  V("... avec le nombre de jours depuis son arrivee", r[0].jours===12, "jours=" + r[0].jours);
  V("un VA qui produit deja n est PAS dans la liste d attente",
    !r.some(x => x.va==="Nael"), "sa date d arrivee est juste une date, pas une alerte");

  // ⚠️ LE CONTROLE QUI COMPTE : la liste des VA n est pas encore lue. Repondre
  // « personne ne tarde » sans avoir regarde, c est le faux vert habituel.
  V("liste des VA non lue = null, PAS une liste vide",
    faire(null, { "Milo": ilYA(12) }, []).attente()===null,
    "une liste vide se lirait « tout le monde a demarre »");
  V("idem si `vas` n est pas un tableau",
    faire({ vas: "boom" }, { "Milo": ilYA(3) }, []).attente()===null, "reponse malformee");

  // Un VA archive (parti) ne doit pas etre signale comme « ne demarre pas ».
  V("un VA parti n est pas signale comme tardif",
    faire(om, { "Elegance": ilYA(40) }, ["Elegance"]).attente().length===0,
    "il est parti : ce n est pas un demarrage rate");

  // Une date illisible ne devient pas 0 jour.
  const sale = faire(om, { "Sale": "pas-une-date" }, []).attente();
  V("une date illisible ne devient pas « inscrit aujourd hui »",
    sale.length===1 && sale[0].jours===null, JSON.stringify(sale));

  // Le rapprochement se fait sur le nom, insensible a la casse et aux espaces.
  V("le rapprochement ignore casse et espaces",
    faire(om, { "  nael ": ilYA(5) }, []).attente().length===0,
    "sinon un espace en trop cree un doublon fantome");

  // Les plus anciens en tete : ce sont eux qui posent question.
  const tri = faire(om, { "A": ilYA(3), "B": ilYA(30), "C": ilYA(9) }, []).attente();
  V("les plus anciens d abord", tri.map(x=>x.va).join("")==="BCA", tri.map(x=>x.va).join(""));
}


// ================= 21) la repetition avant de payer
// C est le SERVEUR qui recalcule le montant : la page ne l envoie pas. Ce
// qu Andre confirme n est donc pas forcement ce qui part -- le 2026-08-15,
// « Payer 150 $ » a ecrit 210 $ (7 abonnes arrives entre le regard et le clic).
{
  const bloc = morceau("function comparerRepetition(", "async function repetitionPaie(");
  const f = new Function(bloc + "; return comparerRepetition;")();

  V("meme montant des deux cotes : on ne derange pas",
    f(150, { ok:true, amount:150 }).etat==="ok", JSON.stringify(f(150,{ok:true,amount:150})));

  // ⚠️ LE CONTROLE QUI COMPTE : le serveur ne dit pas la meme chose.
  const d = f(150, { ok:true, amount:210, nouveaux:420 });
  V("un ecart est signale AVANT la confirmation", d.etat==="diverge", JSON.stringify(d));
  V("... avec l ecart chiffre", d.ecart===60 && d.montant===210 && d.ecran===150, JSON.stringify(d));
  V("... et le nombre d abonnes que le serveur compte", d.nouveaux===420, String(d.nouveaux));

  // Un centime d arrondi n est pas un desaccord : sinon la question sort a
  // chaque paiement et on apprend a cliquer « oui » sans lire.
  V("un centime d arrondi ne declenche rien",
    f(150, { ok:true, amount:150.004 }).etat==="ok", JSON.stringify(f(150,{ok:true,amount:150.004})));
  V("un centime PLEIN, lui, se signale",
    f(150, { ok:true, amount:150.02 }).etat==="diverge", JSON.stringify(f(150,{ok:true,amount:150.02})));

  // Repetition indisponible : on ne BLOQUE pas le paiement, on le dit.
  // Empecher de payer parce qu un apercu n a pas repondu couterait plus cher
  // que le risque qu il couvre.
  for (const cas of [null, undefined, { ok:false, error:"boom" }, { ok:true }, { ok:true, amount:"n/a" }]) {
    V("repetition indisponible = on le DIT, on ne bloque pas (" + JSON.stringify(cas) + ")",
      f(150, cas).etat==="indisponible", JSON.stringify(f(150, cas)));
  }

  // Le montant de l ecran illisible : le serveur fait foi, sans faux ecart.
  V("ecran illisible : on prend le serveur sans crier a l ecart",
    f(NaN, { ok:true, amount:210 }).etat==="ok", JSON.stringify(f(NaN,{ok:true,amount:210})));
}


// ================= 22) le compte de resultat fige, mois par mois
// Il est RECALCULE a chaque affichage, avec les couts d outils d AUJOURD HUI.
// Le 1er du mois, celui du mois precedent disparait et se reconstruit avec des
// charges qu il n avait pas : deux mois jamais comparables.
{
  const bloc = morceau("function pnlMoisTermines(", "function comparerRepetition(");
  const f = new Function(bloc + "; return pnlMoisTermines;")();

  const hist = [
    { d:"2026-07-05", mois:"2026-07", profit: 900,  caNet: 4000 },
    { d:"2026-07-31", mois:"2026-07", profit: 3100, caNet: 12000 },
    { d:"2026-08-10", mois:"2026-08", profit: 1200, caNet: 5000 },
    { d:"2026-08-31", mois:"2026-08", profit: 4050, caNet: 14800 },
    { d:"2026-09-09", mois:"2026-09", profit: 800,  caNet: 3000 }
  ];
  const r = f(hist, "2026-09");
  V("le mois EN COURS n est pas presente comme fige",
    !r.some(x => x.mois==="2026-09"), JSON.stringify(r.map(x=>x.mois)));
  V("le resultat d un mois = son DERNIER releve",
    r.find(x=>x.mois==="2026-08").profit===4050, JSON.stringify(r));
  V("... et pas le premier", r.find(x=>x.mois==="2026-07").profit===3100, JSON.stringify(r));
  V("les mois sortent dans l ordre", r.map(x=>x.mois).join(",")==="2026-07,2026-08", r.map(x=>x.mois).join(","));
  V("on sait combien de jours composent le mois fige",
    r.find(x=>x.mois==="2026-08").jours===2, String(r.find(x=>x.mois==="2026-08").jours));

  // ⚠️ LE CONTROLE QUI COMPTE : historique pas lu. Rendre une liste vide se
  // lirait « aucun mois n a jamais fait de profit ».
  V("historique non lu = null, PAS une liste vide", f(null, "2026-09")===null, String(f(null,"2026-09")));
  V("idem si la reponse est malformee", f("boom", "2026-09")===null, String(f("boom","2026-09")));

  // Un mois dont le profit n a pas pu etre mesure garde `null` : il ne doit pas
  // etre affiche comme un mois a 0 $.
  const nul = f([{ d:"2026-07-31", mois:"2026-07", profit:null }], "2026-09");
  V("un profit non mesure reste null, pas 0", nul[0].profit===null, JSON.stringify(nul));

  // Aucun mois termine : la liste est vide, mais ce n est pas `null` -- c est
  // une vraie reponse (« pas encore »), pas une ignorance.
  V("aucun mois termine = liste vide, et c est une vraie reponse",
    Array.isArray(f([{ d:"2026-09-01", mois:"2026-09", profit:100 }], "2026-09")), "doit rester un tableau");
}


// ================= 23) une source, TROIS detecteurs : ils avouent ensemble
// Ce matin j ai appris a `renderDecroche` a dire « je n ai pas mesure ». Mais
// TROIS detecteurs vivent sur `VAQZ_DATA` -- decrochage, decollages, anomalies
// -- et je n en avais rendu qu UN seul honnete. Les deux autres continuaient de
// se cacher en silence : le motif des « jumeaux » que je passe la journee a
// corriger, commis par moi, le jour meme.
//
// Ce controle lit le VRAI fichier. Un quatrieme detecteur ajoute demain sans
// l aveu fera echouer ce banc.
//
// ⚠️ PREMIERE VERSION FAUSSE, gardee en memoire : elle decoupait le corps d une
// fonction « jusqu a la prochaine declaration de fonction ». La ligne
// `let VAQZ_DATA=null, ...` tombait donc dans la tranche de `renderCoutOpp`,
// qui ne lit pourtant PAS cette source -- et le banc a accuse une fonction
// innocente. On compte les accolades, on ne devine plus.
{
  const bornes = (nom) => {
    const i = src.indexOf("\nfunction " + nom + "(");
    if (i < 0) return null;
    const j = src.indexOf("{", i);
    let prof = 0, k = j;
    for (; k < src.length; k++) {
      if (src[k] === "{") prof++;
      else if (src[k] === "}") { prof--; if (prof === 0) break; }
    }
    return src.slice(j, k + 1);
  };

  // Toutes les fonctions render* du fichier, decoupees a l accolade.
  const noms = [...src.matchAll(/\nfunction (render[A-Za-z0-9_$]*)\(/g)].map(m => m[1]);
  const consommateurs = [], sansAveu = [];
  for (const n of noms) {
    const c = bornes(n);
    if (!c || !c.includes("VAQZ_DATA")) continue;
    consommateurs.push(n);
    if (!c.includes("vaqzMesure")) sansAveu.push(n);
  }

  V("les trois detecteurs de VAQZ_DATA sont bien tous la",
    consommateurs.length === 3, "trouves : " + consommateurs.join(", "));
  V("chacun sait dire « je n ai pas mesure »", sansAveu.length === 0,
    "ceux-la se cachent en silence quand la source est muette : " + sansAveu.join(", "));

  // ⚠️ MEME MOTIF, DEUXIEME SOURCE, LE MEME JOUR. J ai appris a `renderVaRisque`
  // a dire depuis quand la collecte est arretee ; les trajectoires et le journal
  // automatique lisent la MEME charge `VASANTE` et ne disaient rien. Une panne de
  // releve fait pourtant chuter les deux, puisque les journees non mesurees
  // comptent comme des journees a zero dans les courbes.
  const consVs = [], sansVs = [];
  for (const n of noms) {
    const c = bornes(n);
    if (!c || !c.includes("VASANTE")) continue;
    consVs.push(n);
    if (!c.includes("bandeauVaSante") && !c.includes("joursSansReleve") && !c.includes("VASANTE.mesure")) sansVs.push(n);
  }
  V("les panneaux qui lisent VASANTE sont bien tous la", consVs.length >= 3, "trouves : " + consVs.join(", "));
  V("chacun dit depuis quand la collecte est arretee", sansVs.length === 0,
    "ceux-la affichent des courbes creusees par une panne sans le dire : " + sansVs.join(", "));

  // Un controle qu on n a jamais vu echouer ne prouve rien.
  {
    const faux = "\nfunction renderBidon(){ const d=VAQZ_DATA; return; }";
    V("... et le controle attrape bien une fonction qui lit la source sans avouer",
      faux.includes("VAQZ_DATA") && !faux.includes("vaqzMesure"),
      "le controle ne reconnait plus la forme qu il surveille");
  }
}


// ══ 24. LA TUILE DE LA FERME iPHONE : JAMAIS DE VERT PAR DEFAUT ══════════════
// La ferme tourne sur le PC, pas sur Railway : le cerveau ne la sonde pas, elle
// POUSSE son etat. « Rien recu » et « recu il y a 3 h » sont donc des cas
// NORMAUX -- et ils ne veulent PAS dire « tout va bien ». Un voyant vert pendant
// que la ferme est en pause serait exactement la faute que cette tuile existe
// pour eviter.
{
  const b = morceau("async function fermeDansLesCartes(tools){", "async function load(){");
  const avec = (reponse) => new Function("TOKEN","HUB_BASE","fetch",
    b + "; return fermeDansLesCartes;")("jeton","http://x", reponse);
  const lire = async (rep) => {
    const t = {};
    await avec(async () => ({ ok:true, json: async () => rep }))(t);
    return t["iphone-panel"];
  };

  {
    const c = await lire({ recue:false, etat:null, muette:true, ageMin:null });
    V("ferme jamais recue : pas de vert", c && c.status !== "online", JSON.stringify(c));
    V("... et elle DIT qu elle n a jamais parle", /jamais re/i.test((c||{}).note||""), (c||{}).note);
    V("... et aucun chiffre n est fabrique",
      c.metrics.comptes === null && c.metrics.ageMin === null, JSON.stringify(c.metrics));
  }
  {
    const c = await lire({ recue:true, muette:true, ageMin:187,
      etat:{ lisible:true, planificateur:true, quarantaine:0, challenges:0, comptes:12 } });
    V("ferme silencieuse depuis 3 h : pas de vert", c.status !== "online", JSON.stringify(c));
    V("... et elle dit depuis quand", String(c.note||"").indexOf("187") >= 0, c.note);
  }
  {
    const c = await lire({ recue:true, muette:false, ageMin:2,
      etat:{ lisible:true, planificateur:false, quarantaine:0, challenges:0, comptes:12,
             pauseAuto:{ quand:"2026-09-12 01:00", comptes:3, raison:"coupe-circuit anti-ban" } } });
    V("mise en PAUSE par le coupe-circuit : voyant eteint", c.status === "offline", JSON.stringify(c));
    V("... et on lit que ce n est pas toi qui l as arretee",
      /PAUSE AUTOMATIQUE/.test(c.note||"") && /coupe-circuit/.test(c.note||""), c.note);
  }
  {
    const c = await lire({ recue:true, muette:false, ageMin:1,
      etat:{ lisible:true, planificateur:true, quarantaine:2, quarantaineNoms:["iris","lina"],
             challenges:1, comptes:12 } });
    V("des comptes en quarantaine : voyant orange", c.status === "warn", JSON.stringify(c));
    V("... et on sait QUI", /iris/.test(c.note||"") && /lina/.test(c.note||""), c.note);
    V("... et combien sont bloques par Instagram", c.metrics.challenges === 1, JSON.stringify(c.metrics));
  }
  {
    const c = await lire({ recue:true, muette:false, ageMin:1,
      etat:{ lisible:true, planificateur:true, quarantaine:0, challenges:0, comptes:12,
             alertesMuettes:true } });
    V("un canal d alerte vide se dit MEME quand tout va bien",
      /aucun canal d/.test(c.note||""), c.note);
  }
  {
    // Le controle doit savoir NE PAS alarmer, sinon il est inerte.
    const c = await lire({ recue:true, muette:false, ageMin:3,
      etat:{ lisible:true, planificateur:true, quarantaine:0, challenges:0, comptes:12,
             alertesMuettes:false } });
    V("tout va bien : voyant vert et rien a lire", c.status === "online" && !c.note, JSON.stringify(c));
    V("... et l age est affiche", c.metrics.ageMin === 3, JSON.stringify(c.metrics));
  }
  {
    // Le cerveau muet ne doit pas casser le reste de la page.
    const t = {};
    let leve = null;
    try {
      await avec(async () => { throw new Error("hors ligne"); })(t);
    } catch (e) { leve = e; }
    V("cerveau injoignable : la tuile se tait, elle ne casse pas la page",
      leve === null && t["iphone-panel"] === undefined, String(leve));
  }
}


// ══ 25. « CE QUE JE NE SAIS PAS AUJOURD'HUI » ════════════════════════════════
// 53 fonctions d'affichage savent dire « je n'ai pas mesure », chacune dans son
// coin sur 80 panneaux. Rien ne les rassemblait. Ce bandeau ne rejuge rien : il
// APPELLE les controles existants. Ce qui compte ici :
//   - il ne fabrique pas d'inconnu quand tout est mesure (sinon il n'est plus lu) ;
//   - un helper qui LEVE ne doit pas emporter tout l'aveu ;
//   - chaque inconnu dit DEPUIS QUAND quand l'information existe.
{
  const b = morceau("function mesuresManquantes(){", "function rendreMesuresManquantes(){");
  const NOMS = ["caNetMoisFiable","vaqzMesure","coutRailwayMois","VASANTE","echeancesMesurees","LAST"];
  const faire = (o) => new Function(...NOMS, b + "; return mesuresManquantes;")(
    ...NOMS.map(n => o[n]));

  const TOUT_MESURE = {
    caNetMoisFiable: () => true,
    vaqzMesure: () => ({ mesure:true, perime:false }),
    coutRailwayMois: () => ({ montant:12.5, saisie:true }),
    VASANTE: { mesure:{ joursSansReleve:0 } },
    echeancesMesurees: () => ([{ cle:"cookie", label:"Cookie", j:{n:5}, quoi:"x" }]),
    LAST: { "iphone-panel": { metrics:{ ageMin:3 } } },
  };

  {
    const r = faire(TOUT_MESURE)();
    V("tout est mesure : le bandeau n a rien a dire", r.length === 0, JSON.stringify(r));
  }
  {
    const r = faire(Object.assign({}, TOUT_MESURE, { caNetMoisFiable: () => false }))();
    V("CA net non fiable : il le dit", r.some(x => /CA net/.test(x.quoi)), JSON.stringify(r));
  }
  {
    const r = faire(Object.assign({}, TOUT_MESURE, { VASANTE:{ mesure:{ joursSansReleve:9 } } }))();
    const l = r.find(x => /Sant/.test(x.quoi));
    V("collecte VA arretee : il le dit", !!l, JSON.stringify(r));
    V("... et DEPUIS QUAND", l && l.depuis === "9 j", l && l.depuis);
  }
  {
    const r = faire(Object.assign({}, TOUT_MESURE, { coutRailwayMois: () => ({ montant:31, saisie:false }) }))();
    V("cout Railway estime, pas facture : il le dit",
      r.some(x => /Railway/.test(x.quoi) && /ESTIMATION/.test(x.pourquoi)), JSON.stringify(r));
  }
  {
    const r = faire(Object.assign({}, TOUT_MESURE, {
      echeancesMesurees: () => ([{ label:"Proxy", j:null, quoi:"le scraping s arrete" }]) }))();
    V("une echeance non mesuree ressort, avec sa consequence",
      r.some(x => /Proxy/.test(x.quoi) && /scraping/.test(x.pourquoi)), JSON.stringify(r));
  }
  {
    const r = faire(Object.assign({}, TOUT_MESURE, { LAST:{ "iphone-panel":{ metrics:{ ageMin:null } } } }))();
    V("ferme muette : elle figure parmi les inconnus",
      r.some(x => /Ferme iPhone/.test(x.quoi)), JSON.stringify(r));
  }
  {
    // LE CONTROLE QUI COMPTE : un helper casse ne doit pas faire disparaitre
    // l'aveu des autres. Sinon la page se taberait au moment ou elle sait le
    // moins de choses -- l'inverse de ce qu'on veut.
    const r = faire(Object.assign({}, TOUT_MESURE, {
      caNetMoisFiable: () => { throw new Error("casse"); },
      VASANTE: { mesure:{ joursSansReleve:4 } } }))();
    V("un controle qui leve n emporte pas tout le bandeau",
      r.some(x => /Sant/.test(x.quoi)), JSON.stringify(r));
  }
  {
    // Helpers absents (vieille page, chargement partiel) : aucun plantage.
    let leve = null, r = null;
    try { r = faire({ caNetMoisFiable:undefined, vaqzMesure:undefined, coutRailwayMois:undefined,
                      VASANTE:undefined, echeancesMesurees:undefined, LAST:undefined })(); }
    catch(e){ leve = e; }
    V("helpers absents : il ne plante pas", leve === null, String(leve));
    V("... et il ne pretend pas que tout va bien",
      Array.isArray(r) && r.some(x => /Sant/.test(x.quoi)),
      "VASANTE absente = sante des VA inconnue : " + JSON.stringify(r));
  }
}


// ══ 26. LE BLOC-NOTES : « enregistre » ne doit pas mentir ════════════════════
// Il n'ecrivait que dans le navigateur en affichant « ✓ enregistre ». Vidage du
// navigateur, autre machine ou telephone -> bloc-notes vide, sans un mot.
// Ce qui compte maintenant :
//   - on n'ENVOIE RIEN avant d'avoir LU (sinon une lecture ratee suivie d'une
//     frappe pousse un texte vide par-dessus le vrai) ;
//   - le mot affiche correspond a ce qui s'est REELLEMENT passe ;
//   - le serveur fait reference au chargement, SAUF si on a deja tape.
{
  const corps = morceau('{ const np=$("#npText"); if(np){', 'np.addEventListener("input",()');
  const code = corps + '; return { npPousser, saveNp, np, lu:()=>NP_LU }; } }';

  const monter = (opts) => {
    const champs = { "#npText": { value: opts.local || "" }, "#npSaved": { textContent:"", style:{} } };
    const envois = [];
    const faux$ = (s) => champs[s] || null;
    const stock = { data:{}, getItem(k){ return (k in this.data)?this.data[k]:null; },
                    setItem(k,v){ this.data[k]=String(v); } };
    if(opts.local!=null) stock.data["ccn_notepad"]=opts.local;
    const fauxFetch = async (url, o) => {
      envois.push({ url, methode:(o&&o.methode)||(o&&o.method)||"GET", corps:o&&o.body });
      if(o && o.method === "POST") {
        if(opts.postKo) throw new Error("reseau");
        return { ok:true, json: async () => ({ ok:true }) };
      }
      if(opts.lectureKo) throw new Error("muet");
      return { ok:true, json: async () => ({ texte: opts.serveur==null?"":opts.serveur }) };
    };
    const api = new Function("$","TOKEN","HUB_BASE","fetch","localStorage","setTimeout","clearTimeout", code)(
      faux$, opts.token===undefined?"jeton":opts.token, "http://x", fauxFetch, stock,
      (f)=>{ return 0; }, ()=>{});
    return { api, envois, champs, stock };
  };
  const souffler = () => new Promise(r=>setImmediate(r));

  {
    // Hors ligne : rien ne part, et le mot ne promet pas le cerveau.
    const m = monter({ token:"", local:"mes notes" });
    await m.api.saveNp();
    V("bloc-notes hors ligne : rien n est envoye",
      m.envois.length === 0, JSON.stringify(m.envois));
    V("... et le mot ne dit pas « enregistre » tout court",
      /cet appareil seulement/.test(m.champs["#npSaved"].textContent), m.champs["#npSaved"].textContent);
    V("... mais le texte est bien garde en local",
      m.stock.getItem("ccn_notepad") === "mes notes", m.stock.getItem("ccn_notepad"));
  }
  {
    // LE CONTROLE QUI COMPTE : lecture ratee -> on n'ecrase PAS le cerveau.
    const m = monter({ local:"brouillon local", lectureKo:true });
    await souffler();
    m.envois.length = 0;
    await m.api.saveNp();
    V("lecture ratee : aucune ECRITURE a l aveugle",
      !m.envois.some(e => e.methode === "POST" || /POST/.test(String(e.methode))),
      "un texte serait parti par-dessus le vrai : " + JSON.stringify(m.envois));
    V("... et il le DIT au lieu de faire semblant",
      /pas encore synchronis/.test(m.champs["#npSaved"].textContent), m.champs["#npSaved"].textContent);
  }
  {
    // Lecture reussie : le serveur fait reference.
    const m = monter({ local:"vieux", serveur:"texte du cerveau" });
    await souffler(); await souffler();
    V("au chargement, le cerveau fait reference",
      m.champs["#npText"].value === "texte du cerveau", m.champs["#npText"].value);
    V("... et le local est remis a jour",
      m.stock.getItem("ccn_notepad") === "texte du cerveau", m.stock.getItem("ccn_notepad"));
    V("... et la lecture est marquee reussie", m.api.lu() === true);
  }
  {
    // Apres lecture, une frappe part vraiment, et le mot est mérité.
    const m = monter({ local:"", serveur:"a" });
    await souffler(); await souffler();
    m.envois.length = 0;
    m.champs["#npText"].value = "ab";
    await m.api.saveNp();
    V("apres lecture, la frappe part au cerveau",
      m.envois.some(e => /bloc-notes/.test(e.url)) && /"ab"/.test(String(m.envois[0].corps||"")),
      JSON.stringify(m.envois));
    V("... et « ✓ enregistre » n est dit qu apres confirmation",
      m.champs["#npSaved"].textContent.indexOf("enregistr") >= 0, m.champs["#npSaved"].textContent);
  }
  {
    // Envoi refuse : le mot doit le dire, pas mentir.
    const m = monter({ local:"", serveur:"a", postKo:true });
    await souffler(); await souffler();
    m.champs["#npText"].value = "perdu ?";
    await m.api.saveNp();
    V("envoi refuse : le mot avoue l echec",
      /NON envoy/.test(m.champs["#npSaved"].textContent), m.champs["#npSaved"].textContent);
    V("... et le texte reste garde en local",
      m.stock.getItem("ccn_notepad") === "perdu ?", m.stock.getItem("ccn_notepad"));
  }
}


// ══ 27. LA SONDE DES TACHES : 450 LECTURES DE BASE PAR HEURE ═════════════════
// `/api/hub/tasks` lit la base a CHAQUE appel (aucun cache serveur, contrairement
// aux autres routes qui servent un cache de 10 a 30 min). A 8 s, cela faisait 450
// requetes par heure d'onglet ouvert, pour un tableau qui bouge quelques fois par
// jour et qui n'est qu'un panneau sur 80.
// Ce qu'on verifie : on espace QUAND ON NE REGARDE PAS, et jamais au prix de la
// reactivite -- sinon la « correction » ferait attendre une carte deplacee.
{
  const b = morceau("function tkDoitSonder(tick, maintenant){", "let TK_TICK=0;");
  const faire = (regarde, derniereEdition) => new Function("tkRegarde","TK_LAST_EDIT",
    b + "; return tkDoitSonder;")(() => regarde, derniereEdition);

  const T = 1757700000000;
  {
    const f = faire(true, 0);
    V("panneau REGARDE : on sonde a chaque tour (8 s)",
      [1,2,3,4,5,6,7].every(t => f(t, T) === true));
  }
  {
    const f = faire(false, 0);
    const sondes = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16].filter(t => f(t, T));
    V("panneau pas regarde : on espace a un tour sur huit",
      sondes.length === 2 && sondes[0] === 8 && sondes[1] === 16, JSON.stringify(sondes));
  }
  {
    // LE CONTROLE QUI COMPTE : espacer ne doit pas faire attendre ce qu'on vient
    // de taper. Une carte deplacee a l'instant part au tour suivant.
    const f = faire(false, T - 3000);
    V("une modification recente part tout de suite, meme panneau ferme",
      f(3, T) === true);
    const g = faire(false, T - 120000);
    V("... mais une modification VIEILLE ne rouvre pas le robinet",
      g(3, T) === false, "sinon on repart a 450 lectures par heure");
  }
  {
    // Le controle doit savoir dire NON, sinon il est inerte.
    const f = faire(false, 0);
    V("le controle sait refuser (il n est pas inerte)", f(1, T) === false);
  }
}


// ══ 28. JETON EXPIRE : NE PAS S'ENFERMER DEHORS ══════════════════════════════
// Mesure : 147 appels au cerveau, SEPT seulement savent reconnaitre un refus.
// Avec un jeton perime, l'ouverture de la page en tirait ~50 d'un coup ; le
// compteur d'echecs du cerveau (25 / 15 min) etait franchi immediatement, et la
// route de connexion passant par le MEME compteur, se reconnecter repondait
// « Trop de tentatives refusees » pendant 15 minutes -- pour des tentatives
// jamais faites.
{
  const bAll = morceau("function loadAll(){", "].forEach(function(f)");
  V("loadAll se tait quand l auth est refusee",
    /if\(AUTH_KO\)\s*return;/.test(bAll),
    "sans ce garde, cinquante appels partent pour etre tous refuses");
  // Il doit se taire AVANT de construire sa liste, pas apres.
  V("... et il se tait AVANT de lancer quoi que ce soit",
    bAll.indexOf("AUTH_KO") < bAll.indexOf("loadOM"),
    "le garde arrive trop tard dans la fonction");

  const bLente = morceau("function boucleLente(){", "function _argentEnAttente(");
  V("la boucle lente aussi", /if\(AUTH_KO\)\s*return;/.test(bLente), bLente.slice(0, 120));

  const bLoad = morceau("async function load(){", "function togglePin(");
  V("un refus leve le drapeau", /authFail=true; authRefusee\(\)/.test(bLoad),
    "le drapeau n est jamais leve : le garde ne servira jamais");
  V("... et une lecture reussie le baisse", /authRetablie\(\)/.test(bLoad),
    "sans ca, la page reste muette APRES la reconnexion");

  // LE CONTROLE QUI COMPTE : au demarrage, `loadAll()` ne doit plus partir
  // AVANT de savoir si le jeton est bon. C'est ce depart immediat qui franchissait
  // le compteur d'echecs.
  const src2 = fs.readFileSync(FICH, "utf8");
  V("au demarrage, loadAll attend la premiere lecture",
    /PREMIER_LOAD[\s\S]{0,400}loadAll\(\)/.test(src2),
    "loadAll() repart sans attendre : la rafale revient");
  V("... et la premiere lecture est bien gardee dans une promesse",
    /const PREMIER_LOAD = load\(\);/.test(src2),
    "PREMIER_LOAD n existe plus : l attente ci-dessus ne veut plus rien dire");
  // Et il ne doit plus exister d appel nu en debut de ligne.
  V("plus aucun `loadAll();` lance sans condition",
    !/(?:^|\n)\s*loadAll\(\);/.test(src2),
    "un appel nu subsiste : il repartira avant la reponse");
}


// ══ 29. DEUX AUDITS DU 11-12/09, RENDUS PERMANENTS ═══════════════════════════
// Je les ai passes a la main et ils ont trouve de vrais defauts. Mais un audit
// manuel ne vaut que pour le jour ou on le passe.
{
  const src3 = fs.readFileSync(FICH, "utf8");

  // ── (a) UN MESSAGE ADRESSE A UN ELEMENT QUI N'EXISTE PAS ──────────────────
  // `flashMsg(id, msg)` fait `if (!el) return;` : il sort EN SILENCE quand sa
  // cible manque. Appele avec un identifiant absent de la page, il refusait une
  // saisie sans un mot -- le bouton semblait mort. Trouve dans les trois sites
  // finance le 12/09 ; un refus muet est pire que le bug qu'il corrige.
  {
    // Les fonctions « parle a un element et abandonne en silence ».
    const muettes = [];
    const rxDef = /function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^)]*\)\s*\{[\s\S]{0,300}?getElementById\(\s*\2\s*\)[\s\S]{0,160}?if\s*\(\s*!\s*\w+\s*\)\s*return\s*;/g;
    let m;
    while ((m = rxDef.exec(src3)) !== null) muettes.push(m[1]);

    // Les identifiants qui existent vraiment dans la page (dont ceux fabriques).
    const ids = new Set([...src3.matchAll(/id\s*=\s*["']([^"']+)["']/g)].map(x => x[1]));
    [...src3.matchAll(/\.id\s*=\s*["']([^"']+)["']/g)].forEach(x => ids.add(x[1]));
    const prefixes = [...src3.matchAll(/["']([a-z]+-)["']\s*\+/g)].map(x => x[1]);
    const connu = (x) => ids.has(x) || prefixes.some(p => x.startsWith(p));

    const perdus = [];
    for (const f of new Set(muettes)) {
      const rx = new RegExp("\\b" + f + "\\s*\\(\\s*['\"]([^'\"]+)['\"]", "g");
      let a;
      while ((a = rx.exec(src3)) !== null) {
        if (!connu(a[1])) perdus.push(f + "('" + a[1] + "')");
      }
    }
    V("aucun message n est adresse a un element inexistant",
      perdus.length === 0,
      "ces messages partent dans le vide (l utilisateur ne voit RIEN) : " + [...new Set(perdus)].join(", "));
    V("... et le detecteur a bien trouve des fonctions a surveiller",
      muettes.length > 0, "il ne reconnait plus la forme : il est inerte");
  }

  // ── (b) UNE DATE COMPAREE A UNE HEURE ─────────────────────────────────────
  // `Date.parse(jour + "T00:00:00")` SANS suffixe est lu en heure de PARIS, alors
  // que les dates viennent du cerveau en heure METIER (UTC+1 fixe). Entre 22 h et
  // minuit l ete, « 12 jours » devenait « 13 jours ». Deux heures par jour.
  // Trouve le 12/09 dans `vaEnAttente` ; la regle est : on compare des DATES DE
  // CALENDRIER ancrees a minuit UTC, jamais des instants.
  {
    // ⚠️ ON RETIRE LES COMMENTAIRES D'ABORD. Ce detecteur s'est accuse lui-meme
    // au premier lancement : le commentaire qui EXPLIQUE le correctif cite la
    // forme fautive. Un banc qui lit le texte brut accuse toujours celui qui a
    // pris la peine d'ecrire pourquoi.
    const codeSeul = src3.split("\n")
      .filter(l => { const t = l.trim(); return t && !t.startsWith("//") && !t.startsWith("*"); })
      .join("\n");
    const sans = [...codeSeul.matchAll(/Date\.parse\(([^)]{0,80}?)T00:00:00(?!Z)/g)]
      .map(x => x[0].slice(0, 70));
    V("aucune date n est comparee en heure du navigateur",
      sans.length === 0,
      "ces lectures sont en heure de Paris alors que les dates sont en heure metier : "
      + sans.join(" | "));
    // Le controle doit savoir echouer.
    V("... et le detecteur reconnait bien la forme fautive",
      /Date\.parse\(([^)]{0,80}?)T00:00:00(?!Z)/.test('Date.parse(d+"T00:00:00")'),
      "le detecteur est inerte");
  }
}


// ══ 30. « LE FIL EST VIVANT » N'EST PAS « LE TRAVAIL A EU LIEU » ═════════════
// Le tick du planificateur de la ferme note l'heure a la DEUXIEME ligne, donc
// AVANT de travailler : il se disait « a l'heure » meme en plantant de bout en
// bout, et un `except: pass` avalait l'echec. Le battement porte maintenant
// TROIS choses (dernier tick, dernier SUCCES, echecs d'affilee) ; il faut que
// l'ecran les juge, sinon on aurait juste deplace le silence.
{
  const b = morceau("async function fermeDansLesCartes(tools){", "async function load(){");
  const lire = async (etat) => {
    const t = {};
    await new Function("TOKEN","HUB_BASE","fetch", b + "; return fermeDansLesCartes;")(
      "jeton","http://x",
      async () => ({ ok:true, json: async () => ({ recue:true, muette:false, ageMin:1, etat:etat }) })
    )(t);
    return t["iphone-panel"];
  };
  const SAIN = { lisible:true, planificateur:true, quarantaine:0, challenges:0, comptes:12,
                 alertesMuettes:false, dernierSucces: Math.floor(Date.now()/1000) - 60,
                 echecsSuite:0, panneauDepuis: Math.floor(Date.now()/1000) - 7200 };

  {
    const c = await lire(SAIN);
    V("planificateur sain : rien a signaler", c.status === "online" && !c.note, JSON.stringify(c));
  }
  {
    const c = await lire(Object.assign({}, SAIN, { echecsSuite:4, derniereErreur:"cookie mort" }));
    V("quatre passages rates d affilee : voyant orange", c.status === "warn", JSON.stringify(c));
    V("... et on lit qu il se croit a l heure sans rien publier",
      /ÉCHOU|ECHOU/.test(c.note||"") && /cookie mort/.test(c.note||""), c.note);
  }
  {
    // Panneau demarre depuis 2 h et AUCUN passage abouti : anormal.
    const c = await lire(Object.assign({}, SAIN, { dernierSucces:null }));
    V("aucun passage abouti depuis le demarrage : signale", c.status === "warn", JSON.stringify(c));
  }
  {
    // ... mais un panneau qui vient de demarrer n a pas encore eu le temps.
    const c = await lire(Object.assign({}, SAIN, { dernierSucces:null,
      panneauDepuis: Math.floor(Date.now()/1000) - 60 }));
    V("un panneau qui vient de demarrer n est PAS accuse", c.status === "online",
      "sinon la tuile crie orange a chaque redemarrage : " + JSON.stringify(c));
  }
  {
    const vieux = Math.floor(Date.now()/1000) - 3600;
    const c = await lire(Object.assign({}, SAIN, { dernierSucces:vieux }));
    V("dernier succes vieux d une heure : signale, avec le delai",
      c.status === "warn" && /60 min/.test(c.note||""), c.note);
  }
}


// ══ 31. LA RAISON D'UNE PANNE ETAIT ENVOYEE ET JAMAIS AFFICHEE ═══════════════
// Le cerveau calcule, pour chaque outil en panne, une raison PRECISE
// (« planificateur arrete (plus rien depuis 40 min) », « drive (no auth) »,
// « base de donnees injoignable ») et son commentaire dit pourquoi : « hors
// ligne » tout court envoie chercher au mauvais endroit quand le service REPOND
// mais que son TRAVAIL est arrete.
// Elle arrivait bien dans la carte (`d.raison`)... et RIEN ne la lisait : une
// pastille rouge, sans un mot. Une mesure juste, avec personne au bout du fil.
{
  const b = morceau("function cardHTML(t, data){", "function inWorld(");
  const faire = () => new Function(
    "PINS","TOKEN","escapeHtml","statusClass","deltaHTML","sparkSVG","fmtInt",
    b + "; return cardHTML;")(
      [], "jeton",
      (x) => String(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"),
      (s) => s==="online"?"on":s==="offline"?"off":s==="warn"?"warn":"",
      () => "", () => "", (v) => String(v));

  const carte = (outil, etat) => faire()(outil, { "x": etat });
  const OUTIL = { id:"x", name:"Truc", icon:"T", metrics:[{k:"a",l:"A",f:v=>String(v)}] };

  {
    const h = carte(OUTIL, { status:"offline", raison:"planificateur arrete (plus rien depuis 40 min)", metrics:{} });
    V("outil en panne : la raison s affiche",
      /planificateur arrete/.test(h) && /plus rien depuis 40 min/.test(h),
      "pastille rouge sans un mot : " + h.slice(0, 160));
  }
  {
    const h = carte(OUTIL, { status:"warn", raison:"drive (no auth configured)", metrics:{} });
    V("etat orange aussi", /no auth configured/.test(h), h.slice(0, 160));
  }
  {
    // ... mais PAS quand tout va bien : un bandeau permanent ne se lit plus.
    const h = carte(OUTIL, { status:"online", raison:"peu importe", metrics:{} });
    V("outil en ligne : aucune raison affichee", !/peu importe/.test(h), h.slice(0, 160));
  }
  {
    // Carte « voyant seul » (Grind) : elle n a pas de metriques, la raison doit
    // quand meme apparaitre -- sinon les outils les plus muets restent muets.
    const h = carte({ id:"x", name:"Grind", icon:"G", voyantOnly:true },
                    { status:"offline", raison:"base de donnees injoignable" });
    V("carte « voyant seul » : la raison s affiche aussi",
      /base de donnees injoignable/.test(h), h.slice(0, 160));
  }
  {
    // Une raison vient du reseau : elle doit etre echappee comme tout le reste.
    const h = carte(OUTIL, { status:"offline", raison:"<img src=x onerror=alert(1)>", metrics:{} });
    V("la raison est echappee (elle vient du reseau)",
      !/<img/.test(h) && /&lt;img/.test(h), h.slice(0, 200));
  }
  {
    // Sans raison, rien ne doit casser ni apparaitre.
    const h = carte(OUTIL, { status:"offline", metrics:{} });
    V("pas de raison : la carte se rend quand meme", typeof h === "string" && h.length > 10);
  }
}


// ══ 32. AUCUN TEXTE N'ENTRE DANS DU HTML SANS ETRE ECHAPPE ═══════════════════
// Audit securite du 12/09. Verdict : PAS de faille -- le texte des actions est
// bien echappe, et les libelles des boutons rapides sont des chaines ecrites en
// dur (« 💸 Payer », « 👤 Fiche »).
// MAIS le point d'insertion, lui, ne l'etait pas : le jour ou quelqu'un rend un
// libelle dynamique (`label: "👤 " + f.va`), la faille nait SANS UN MOT. Un nom
// de VA vient d'un nom de lien, et ce sont les VA qui creent leurs liens.
// Ce banc ferme la porte avant qu'on l'ouvre.
{
  const src4 = fs.readFileSync(FICH, "utf8");
  const ligneActions = src4.split("\n").find(l => l.includes('class="act-quick"'));
  V("le rendu des actions est bien la", !!ligneActions);
  if (ligneActions) {
    V("le libelle du bouton rapide est echappe",
      /escapeHtml\(a\.quick\.label\)/.test(ligneActions),
      "un libelle dynamique deviendrait une injection : " + ligneActions.slice(0, 140));
    V("... et le texte de l action aussi",
      /escapeHtml\(a\.text\)/.test(ligneActions), ligneActions.slice(0, 140));
  }

  // Le meme controle, generalise : dans TOUTE insertion `innerHTML`, une
  // expression qui lit un champ de TEXTE venu du reseau doit passer par
  // `escapeHtml`. On ne regarde que les champs qui portent du texte libre --
  // un nombre ou une classe CSS ne peut rien injecter.
  const CHAMPS = /\.\s*(va|name|nom|link_name|title|body|fan|username|pseudo|raison|note|text|label)\b/;
  const nus = [];
  src4.split("\n").forEach((l, n) => {
    const t = l.trim();
    if (t.startsWith("//") || t.startsWith("*")) return;
    if (!l.includes("innerHTML") && !l.includes("insertAdjacentHTML")) return;
    const m = l.match(/\$\{[^{}]*\}/g) || [];
    m.forEach((e) => {
      if (!CHAMPS.test(e)) return;
      if (/escapeHtml\(|esc\(|encodeURIComponent\(/.test(e)) return;
      // `t.name` vient de TOOLS, une constante ecrite dans la page : rien de
      // reseau la-dedans. On l'exempte NOMMEMENT plutot que d'elargir la regle.
      if (/t\.name/.test(e) && /off\.map/.test(l)) return;
      nus.push("l." + (n + 1) + " " + e.slice(0, 70));
    });
  });
  V("aucun texte reseau n entre dans du HTML sans echappement",
    nus.length === 0,
    "a verifier a la main : " + nus.join(" | "));

  // Le controle doit savoir echouer, sinon il est inerte.
  const faux = 'el.innerHTML = `<b>${d.va}</b>`;';
  V("... et le controle attrape bien une insertion nue",
    CHAMPS.test("${d.va}") && !/escapeHtml\(/.test(faux),
    "le controle ne reconnait plus la forme qu il surveille");
}

// ================= RADAR ANTI-FUITE : l'ecran ne double pas un courrier, et ne ment pas
// ⚠️ (12/09) Le serveur refuse maintenant un second DMCA (409). Mais l'ecran,
// sur toute reponse non-OK, OUVRAIT L'EMAIL PRE-REMPLI : il invitait a renvoyer
// le meme courrier a la main. Et « Ignorer », « Infos DMCA enregistrees »
// s'affichaient avant de savoir si le serveur avait accepte.
{
  const attendre = (ms)=>new Promise(r=>setTimeout(r,ms));
  // La fonction a pu devenir `async` : on reprend le mot-cle s'il precede.
  const morceauFn = (debut, fin)=>{ const i=src.indexOf(debut); const b=morceau(debut, fin); return (i>=6 && src.slice(i-6,i)==="async ") ? "async "+b : b; };
  const blocDmca = morceau("async function sendLeakDmca(id){", "renderWatch(); renderLeaks(); renderIdentity();");
  function monterDmca(reponse, delai){
    const etat = { toasts:[], posts:0, mailto:0 };
    const LEAKS=[{id:"f1", model:"Modele-Test", url:"https://ex.test/1", host:"ex.test", status:"new"}];
    const IDENTITY={name:"A", address:"B", email:"c@d.test"};
    const fetch=()=>{ etat.posts++; return new Promise(res=>setTimeout(()=>res(reponse()), delai||5)); };
    const f = new Function("LEAKS","IDENTITY","idComplete","fetch","TOKEN","HUB_BASE","toast","renderLeaks","openDmcaMailto","$",
      blocDmca + "; return sendLeakDmca;");
    const send = f(LEAKS, IDENTITY, i=>!!(i&&i.name&&i.address&&i.email), fetch, "jeton", "http://x",
      (a,b)=>etat.toasts.push(a+" | "+(b||"")), ()=>{}, ()=>{ etat.mailto++; }, ()=>null);
    return { etat, send, LEAKS };
  }
  {
    const m = monterDmca(()=>({ok:false,status:409,json:async()=>({dejaEnvoye:true,to:"abuse@ex.test",error:"DMCA déjà envoyé il y a 2 min — pas de second courrier"})}));
    await m.send("f1");
    V("DMCA deja envoye : l email pre-rempli ne s ouvre PAS", m.etat.mailto===0,
      "l ecran ouvre un email pour renvoyer le meme courrier a la main");
    V("... et l ecran dit pourquoi", m.etat.toasts.some(t=>/déjà/.test(t)), m.etat.toasts.join(" / ")||"aucun message");
  }
  {
    const m = monterDmca(()=>({ok:false,status:409,json:async()=>({busy:true,error:"un envoi est déjà en cours pour cette fuite"})}));
    await m.send("f1");
    V("envoi DMCA deja en cours ailleurs : pas d email pre-rempli non plus", m.etat.mailto===0, "email ouvert");
  }
  {
    const m = monterDmca(()=>({ok:true,status:200,json:async()=>({ok:true,sent:true,to:"abuse@ex.test"})}), 40);
    await Promise.all([m.send("f1"), m.send("f1")]);
    V("deux clics sur DMCA : UNE seule demande d envoi", m.etat.posts===1, m.etat.posts+" demandes parties");
  }
  {
    const m = monterDmca(()=>({ok:true,status:200,json:async()=>({ok:true,sent:true,to:"abuse@ex.test"})}), 5);
    await m.send("f1");
    V("un envoi reussi reste affiche « envoye » (garde-fou du banc)", m.LEAKS[0].status==="sent" && m.etat.mailto===0, JSON.stringify(m.LEAKS[0]));
  }

  // --- « Ignorer » / « Traite » refuse par le serveur ---
  {
    const bloc = morceauFn("function setLeakStatus(id,status){", '{ const b=$("#alAdd");');
    const LEAKS=[{id:"f1",status:"new"}]; const toasts=[];
    const fetch=()=>Promise.resolve({ok:false,status:503,json:async()=>({error:"liste illisible"})});
    const f=new Function("LEAKS","renderLeaks","TOKEN","HUB_BASE","fetch","toast", bloc+"; return setLeakStatus;");
    const set=f(LEAKS,()=>{},"jeton","http://x",fetch,(a,b)=>toasts.push(a+" | "+(b||"")));
    await set("f1","ignored"); await attendre(10);
    V("statut refuse par le serveur : l ecran revient en arriere", LEAKS[0].status==="new",
      "l ecran affiche « "+LEAKS[0].status+" » alors que rien n est enregistre");
    V("... et le dit", toasts.length>0, "aucun message");
  }

  // --- bouton « Scanner » ---
  {
    const bloc = morceau('{ const b=$("#alScan");', '{ const a=$("#alAlias");');
    function monterScan(reponse){
      const toasts=[]; const bouton={textContent:"Scanner",disabled:false,onclick:null};
      const f=new Function("$","TOKEN","HUB_BASE","fetch","toast","loadLeaks", bloc+"; return null;");
      f(()=>bouton,"jeton","http://x",()=>Promise.resolve(reponse()),(a,b)=>toasts.push(a+" | "+(b||"")),()=>{});
      return {bouton,toasts};
    }
    {
      const m=monterScan(()=>({ok:false,status:409,json:async()=>({busy:true,error:"un scan est déjà en cours"})}));
      await m.bouton.onclick();
      V("scan deja en cours : on le dit, ce n est pas une panne",
        m.toasts.some(t=>/déjà/.test(t)) && !m.toasts.some(t=>/impossible/i.test(t)), m.toasts.join(" / "));
      V("... et le bouton redevient cliquable", m.bouton.disabled===false, "bouton bloque");
    }
    {
      const m=monterScan(()=>({ok:true,status:200,json:async()=>({ok:true,scanned:5,found:0,models:1})}));
      await m.bouton.onclick();
      V("1 modele surveille : l ecran dit « 1 modèle », pas le nombre de requetes",
        m.toasts.some(t=>/\b1 modèle\b/.test(t)) && !m.toasts.some(t=>/5 modèles/.test(t)), m.toasts.join(" / "));
    }
    {
      const m=monterScan(()=>({ok:true,status:200,json:async()=>({ok:true,scanned:0,found:0,models:0,coupe:true})}));
      await m.bouton.onclick();
      V("radar coupe cote serveur : on ne pretend pas qu aucun modele n est surveille",
        m.toasts.some(t=>/coupé/.test(t)) && !m.toasts.some(t=>/Aucun modèle/.test(t)), m.toasts.join(" / "));
    }
  }

  // --- infos du titulaire (obligatoires pour l'envoi automatique) ---
  {
    const bloc = morceauFn("function saveIdentity(){", "async function loadIdentity(){");
    const champs={dmName:"A",dmCompany:"",dmAddress:"B",dmPhone:"",dmEmail:"c@d.test",dmSign:""};
    const $=(sel)=>({value:champs[sel.slice(1)]||"", textContent:""});
    const toasts=[];
    const f=new Function("$","localStorage","TOKEN","HUB_BASE","fetch","renderIdentity","toast","idComplete",
      "let IDENTITY={};"+bloc+"; return saveIdentity;");
    const save=f($,{setItem(){}},"jeton","http://x",()=>Promise.resolve({ok:false,status:500,json:async()=>({})}),
      ()=>{},(a,b)=>toasts.push(a+" | "+(b||"")),i=>!!(i&&i.name&&i.address&&i.email));
    await save(); await attendre(10);
    V("infos DMCA refusees par le serveur : l ecran ne dit PAS « enregistrées »",
      // On vise le message de SUCCES, pas le mot : « NON enregistrées » le contient aussi.
      !toasts.some(t=>/^⚖️ Infos DMCA enregistrées/.test(t)) && toasts.some(t=>/NON/.test(t)), toasts.join(" / ")||"aucun message");
  }
}

// ================= ENVOIS « ET ON OUBLIE » : un refus du serveur doit se voir
// ⚠️ (12/09) Neuf enregistrements (taches, rappels, regles, decisions, notes des
// VA, objectif Telegram...) partaient avec `.catch(()=>{})` : la reponse n'etait
// jamais lue, un refus passait pour un succes.
{
  // Controle derive de la page : plus aucun POST dont la reponse est jetee.
  const ENVOI_JETE = /fetch\(HUB_BASE\+"\/api\/[^"]+"\s*,\s*\{[^}]*method:"(POST|PUT|DELETE)"[\s\S]*?\)\.catch\(\(\)=>\{\}\)/;
  const jetes = [];
  src.split("\n").forEach((l, n) => { if (ENVOI_JETE.test(l) && !/\.ok\b/.test(l)) jetes.push("l." + (n + 1)); });
  V("aucun enregistrement dont la reponse du serveur est jetee", jetes.length === 0, "a corriger : " + jetes.join(", "));
  V("... et le controle reconnait la forme d avant",
    ENVOI_JETE.test('fetch(HUB_BASE+"/api/hub/rules",{method:"POST",headers:{"x-hub-token":TOKEN},body:JSON.stringify({rules:RULES})}).catch(()=>{});'),
    "controle inerte");

  // L'aide partagee, executee pour de bon.
  let bloc = null;
  try { bloc = morceau("function envoiServeur(chemin, corps, libelle){", "// 🎯 Objectif mensuel Telegram"); } catch (e) { bloc = null; }
  V("l aide qui lit la reponse du serveur existe", !!bloc, "introuvable : chaque envoi jette sa reponse");
  if (bloc) {
    const toasts = []; let reponse = null;
    const f = new Function("fetch","HUB_BASE","TOKEN","toast", bloc + "; return envoiServeur;");
    const envoi = f(() => Promise.resolve(reponse()), "http://x", "jeton", (a,b) => toasts.push(a + " | " + (b||"")));
    reponse = () => ({ ok:false, status:503 });
    const r1 = await envoi("/api/hub/rules", {rules:[]}, "Règles");
    V("refus du serveur : l envoi rend false", r1 === false, "rend " + r1);
    V("... et l ecran le dit", toasts.length === 1 && /NON enregistré/.test(toasts[0]), toasts.join(" / ") || "aucun message");
    await envoi("/api/hub/rules", {rules:[]}, "Règles");
    V("... une seule fois par minute pendant une saisie", toasts.length === 1, toasts.length + " messages");
    reponse = () => ({ ok:true, status:200 });
    const r2 = await envoi("/api/hub/rules", {rules:[]}, "Règles");
    V("succes : true, sans message", r2 === true && toasts.length === 1, "rend " + r2 + ", " + toasts.length + " messages");
  }
}

// ================= COMPTE DE RESULTAT : le releve du jour part VRAIMENT
// ⚠️ (13/09) Le releve quotidien lisait `ko` et `t`, deux noms copies d'une autre
// fonction et absents de renderRenta : ReferenceError au premier champ, avale par
// le `catch` juste dessous. Depuis le 09/09, AUCUNE ligne n'avait ete envoyee —
// le banc 22 verifiait la relecture d'un historique… que rien ne remplissait.
// Et un refus du serveur (503) ne faisait jamais reessayer : seul un echec RESEAU
// remettait le jour « a noter ».
{
  let bloc = null;
  try { bloc = morceau("  // On fige ce qu'on vient d'afficher, une fois par jour.", "  // 🧾 #7"); } catch (e) { bloc = null; }
  V("le releve du jour est dans renderRenta", !!bloc);
  if (bloc) {
    const notes = [];
    const d = { totals: { netMonth: 5000, margeMonth: 1800 } };
    new Function("d", "revKo", "noterPnl", "jourServeur", "netRate", "coutOutils", "_rw", "primesMois", "ocFee", "tgMonth", "profitReel",
      bloc)(d, () => false, (l) => notes.push(l), () => "2026-09-13", () => 0.8, 120, null, { total: 50 }, 90, 300, 1400);
    V("le releve part (noterPnl est appele)", notes.length === 1, notes.length + " appel — le journal ne recoit rien");
    V("... avec le CA lu, pas null", notes[0] && notes[0].caBrut === 5000 && notes[0].caNet === 4000, JSON.stringify(notes[0]));
    const muet = [];
    new Function("d", "revKo", "noterPnl", "jourServeur", "netRate", "coutOutils", "_rw", "primesMois", "ocFee", "tgMonth", "profitReel",
      bloc)(d, () => true, (l) => muet.push(l), () => "2026-09-13", () => 0.8, 120, null, null, 90, 300, 1400);
    V("revenus muets : le CA part a null (jamais un faux chiffre)", muet[0] && muet[0].caBrut === null, JSON.stringify(muet[0]));
  }
  let fNoter = null;
  try { fNoter = morceau("let PNL_HIST=null", "// Le profit FINAL des mois"); } catch (e) { fNoter = null; }
  V("l envoi du releve est la", !!fNoter);
  if (fNoter) {
    let appels = 0, maintenant = 1757750000000;
    const vraiNow = Date.now; Date.now = () => maintenant;
    try {
      const noter = new Function("TOKEN", "HUB_BASE", "fetch", "renderRenta",
        fNoter + "; return noterPnl;")("jeton", "http://x", () => { appels++; return Promise.resolve({ ok: false, status: 503 }); }, () => {});
      const l = { d: "2026-09-13", caBrut: 5000 };
      noter(l); await new Promise((r) => setTimeout(r, 0));
      noter(l); await new Promise((r) => setTimeout(r, 0));
      V("un refus du serveur ne fait pas marteler (pas de 2e envoi dans la minute)", appels === 1, appels + " envois");
      maintenant += 6 * 60000;
      noter(l); await new Promise((r) => setTimeout(r, 0));
      V("... mais le jour n est PAS considere comme note : on reessaie plus tard", appels === 2, appels + " envoi(s) — le jour est perdu");
    } finally { Date.now = vraiNow; }
  }
}

// ================= LA PAGE ENTIERE SE COMPILE
// ⚠️ (13/09) Les controles ci-dessus extraient des MORCEAUX : une erreur de
// syntaxe ailleurs dans la page (un commentaire `//` colle au milieu d'une ligne
// qui avale la fin de l'instruction) les laisse tous verts, alors que le
// navigateur refuse le script ENTIER — plus aucun panneau ne marche. Vecu en
// corrigeant cette page, rattrape avant publication.
{
  const { Script } = await import("node:vm");
  const reScript = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let ms, n = 0; const erreurs = [];
  while ((ms = reScript.exec(src))) {
    if (/\bsrc\s*=/.test(ms[1])) continue;
    n++;
    try { new Script(ms[2]); } catch (e) { erreurs.push(e.message); }
  }
  V("chaque script de la page se compile", n > 0 && erreurs.length === 0, n + " script(s) ; " + erreurs.join(" | "));
}

// ================= GARDES MORTES : `typeof X==="function"` sur un nom qui n'existe nulle part
// ⚠️ (13/09) La garde evite l'erreur… et cache que la fonctionnalite ne tourne
// JAMAIS : `tkRender` (le tableau se dessine avec `renderTasks`) laissait le
// tableau des taches sur la vue d'avant la connexion ; `money` (absent de la
// page) sortait l'objectif en clair meme en mode discret.
{
  const NAVIGATEUR = new Set(["window","document","navigator","Notification","speechSynthesis","SpeechRecognition",
    "webkitSpeechRecognition","structuredClone","requestIdleCallback","IntersectionObserver","ResizeObserver",
    "BroadcastChannel","AbortController","fetch","Chart","queueMicrotask","crypto","caches","PushManager",
    "ClipboardItem","MediaRecorder","AudioContext","webkitAudioContext","EventSource","WebSocket","matchMedia",
    "requestAnimationFrame","TextEncoder","Blob","File","Image","Audio"]);
  const morts = [];
  const re = /typeof\s+([A-Za-z_$][\w$]*)\s*===?\s*["']function["']/g;
  let m;
  while ((m = re.exec(src))) {
    const nom = m[1];
    if (NAVIGATEUR.has(nom)) continue;
    const e = nom.replace(/\$/g, "\\$");
    const defini = new RegExp(
      "function\\s+" + e + "\\s*\\(" +                       // function nom(
      "|(?:const|let|var)\\s+" + e + "\\b" +                 // const nom
      "|(?:const|let|var)\\s+[^;\\n]*[,{]\\s*" + e + "\\b" + // const a, nom / { nom }
      "|window\\." + e + "\\s*=" +                           // window.nom =
      "|[(,]\\s*" + e + "\\s*[,)=]" +                        // parametre (nom) / (a, nom)
      "|\\b" + e + "\\s*=>"                                  // nom => …
    ).test(src);
    if (!defini) morts.push(nom + " (l." + src.slice(0, m.index).split("\n").length + ")");
  }
  V("aucun appel protege par typeof vers une fonction qui n existe nulle part", morts.length === 0, "gardes mortes : " + morts.join(", "));
}

// ================= ANNULER UNE PAIE : un echec de la correction se VOIT
// ⚠️ (13/09) Le VA a peut-etre deja recu « paie envoyee ». Si l'annulation
// echouait (503, reseau), `.catch(()=>{})` et un 503 lu comme une reponse
// normale : aucun message, et personne ne corrigeait le VA.
{
  let fUnpay = null;
  try { fUnpay = morceau("function unpayVa(va){", "function _assocVide("); } catch (e) { fUnpay = null; }
  V("annuler une paie est la", !!fUnpay);
  if (fUnpay) {
    const essai = async (reponse) => {
      const toasts = [];
      const f = new Function("PAYMENTS", "savePayments", "renderPaie", "LAST", "curPeriod", "TOKEN", "HUB_BASE", "fetch", "toast",
        fUnpay + "; return unpayVa;")([{ va: "VaTest", period: "2026-09-A" }], () => {}, () => {}, {}, () => "2026-09-A", "jeton", "http://x",
        reponse, (a, b) => toasts.push(a + " | " + (b || "")));
      f("VaTest");
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
      return toasts;
    };
    const t503 = await essai(() => Promise.resolve({ ok: false, status: 503, json: async () => ({ error: "file illisible" }) }));
    V("serveur qui refuse : l ecran dit que le VA n est PAS corrige", t503.some((x) => /NON envoy/.test(x)), t503.join(" / ") || "aucun message");
    const tReseau = await essai(() => Promise.reject(new Error("hors ligne")));
    V("pas de reseau : idem", tReseau.some((x) => /NON envoy/.test(x)), tReseau.join(" / ") || "aucun message");
    const tOk = await essai(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, retireeDeLaFile: 1 }) }));
    V("succes : « annule a temps », sans fausse alerte", tOk.length === 1 && /temps/.test(tOk[0]), tOk.join(" / "));
  }
}

console.log("\n== Cloisonnement : aucun nom ni identifiant d'une autre agence dans ce dépôt public ==");
{
  // ⚠️ (13/09) Un commentaire nommait encore une autre agence. Le dépôt est PUBLIC.
  // Liste rangée sous forme d'EMPREINTES (sha256 tronqué) : ce banc n'en contient aucun.
  const { createHash } = await import("node:crypto");
  const INTERDITS = new Set([
    "00139528c9a24aca","01ddadf7b03c336f","04240809cca78a0f","05195963bbd10343","09f49cafe12120ec",
    "0a4eb1fdb8f1de5c","0b76fb9711d4f3d8","0e4b2cc962efb28b","117b26ccb8fb4ed5","13d63234821e9ec8",
    "13f30f775fb6824a","164d9b3b7b836b0e","1b5c1d3c9d8e2808","23c8aa36106a6d89","2404fdeb34a79ea4",
    "2487c0f0728a2861","28fed7d40ff88a12","2b842d2a5611cb20","2db0f8a45c44969b","2defd355f601a479",
    "2e4f57816bec2d5e","2f93527f7fca966a","32a1e3443a1dffd6","33dd18b47a2bda2f","382177b9b31af811",
    "3ba7c23a8258e08a","3fa53103bb563186","40031618ad9bd84b","4026e2a877f67b34","40903c59d19feef1",
    "414b0a2f58514c75","4367104d4aa5846c","438782d2eda360ba","440b88f9b52836bc","44bcdaca8c456ca1",
    "4631f91f323c23a5","47acf82a48cfa5c3","4812789f7130fd12","4b4e7d5db7fc6173","4ca70efcf4260452",
    "4f6105e2260d1223","4f98636470ed11df","5045d78495fc49a1","528f14167d47cc13","5784034037cfe682",
    "5ccf3e630657cfb9","6203340e0745473e","62eb92cbf5bb53a0","698c828d52949145","6a61e9feada0b195",
    "6d8e16e0018bdd1e","70dd997c29c18374","728950ef277f75b7","798b671317f292c1","7a857235760e4737",
    "7b3ca3e426cd521f","7cdf8a37974a5a2b","7d4aa40fd654b74d","84ff7a86c49a362e","869dcf48aa1b92b0",
    "873573645c587e10","88a1ad27d99e95f7","88fec672bcb8d0dc","8acf1bbe8739a2c7","8c9158fef04d879f",
    "8f71957826707804","91e224dd42a264c9","91e52721fc76ee51","928d73f0b47bf95b","940fcb01712ac8d7",
    "944e5ce46de06912","945085b11ad89f21","94a602a952c9818f","97cb5901c79692f4","9901972c0fd08a3d",
    "9a9d685f1d13235e","9b8290893d287b6b","9c156250567a8006","a387c1ca4f96e5bf","ad7007f508bc8dc3",
    "ae6346a0de0fadc9","af4fda792dbbdb79","b3cab839150a5147","b4642f312dcd065b","b48db56e9315a39c",
    "b52e38a9e394d71f","b6888bbd34591be4","b9ac732af2aa0b0b","ba8a36f7c57d1648","bb565a3ddd1cd230",
    "bc1b180e87561b99","c3f523bbf225edca","c64fa36ebda6e4a5","c6fde3bee3cc22b1","c7d6d115b53ecda5",
    "c9c57ae36dd11c95","cd172b28ea547ba3","cd3a54125ac34d97","cd58e30ca91c31ad","ceeea83e61d92f92",
    "d12d7420fab77062","d24068c25bc64c59","d3b87062116daf52","d3f13b5690574a95","d3f1c4c0abc8b49b",
    "d5b1009bdf5cb6fc","d74484802927e141","d77c1280eb9ca1ca","d8502596a6d79611","dd35109949907845",
    "de0ad2a8beed214f","dfc3f1949c56273c","e050e474330b5980","e415bceda0a4df86","e6382b487b75248d",
    "e83f8deafb192805","e9abc5b847a266cf","ec0c02715c499e46","ec1186f266c2d30e","ee22404ac207812e",
    "eff3cc26e4b119c3","f0359bf18e00412f","f05169c93460d65e","f074af7ea0860046","f3b6a2c5c5e9d873",
    "f688f2bd1b183566","f773094574a105ec","f8c78d89c3f2eecd","ff235c3f71bd089b",
  ]);
  const interdits = (texte) => [...new Set((String(texte).match(/(?<!\d)\d{17,20}(?!\d)|[A-Z]+(?![a-z])|[A-Z]?[a-zà-ÿ]+/g) || [])
    .filter((m) => INTERDITS.has(createHash("sha256").update(m.toLowerCase()).digest("hex").slice(0, 16))))];
  const racine = new URL("..", import.meta.url);
  const trouves = [];
  for (const f of ["index.html", "README.md", "manifest.json", "sw.js", "test/banc.mjs"]) {
    const u = new URL(f, racine);
    if (!fs.existsSync(u)) continue;
    fs.readFileSync(u, "utf8").split("\n").forEach((l, n) => { if (interdits(l).length) trouves.push(f + ":" + (n + 1)); });
  }
  V("aucun nom ni identifiant d'une autre agence", trouves.length === 0, trouves.join(", "));
}

// ================= LES CARTES NOURRIES EN ARRIERE-PLAN SE REDESSINENT A L ARRIVEE
// render() lit SMS_DATA et PROXY_DATA_GB pour remplir les cartes du catalogue.
// loadSms rappelait render(LAST) a l arrivee des chiffres ; loadProxy NON : la carte
// « Proxy » restait sur « — » jusqu au tour suivant, et sans fin sur un onglet en
// arriere-plan (mesure le 15/09 : 57 Go et 225 jours recus, carte a « — »).
{
  const src = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const corps = (nom) => {
    const i = src.indexOf("async function " + nom + "(");
    if (i < 0) return "";
    const fins = [src.indexOf("\nasync function ", i + 10), src.indexOf("\nfunction ", i + 10)].filter((x) => x > 0);
    return src.slice(i, fins.length ? Math.min(...fins) : i + 4000);
  };
  for (const nom of ["loadProxy", "loadSms"]) {
    verifie(nom + " redessine les cartes a l arrivee des chiffres", /render\(LAST\)/.test(corps(nom)), "render(LAST) absent de " + nom);
  }
  verifie("Telegram par VA : l age des depenses OnlyChat est dit", /onlychatAgeMin!=null/.test(src), "note d age absente");
}

// ================= TRESORERIE : LE SOLDE SERVI TOUT DE SUITE DIT SON AGE
// Depuis le 15/09 le serveur rend le dernier solde connu pendant qu il relit
// OnlyFans (avant : ~27 s d attente). Un solde ancien affiche sans son age serait
// un « a jour » implicite : le panneau doit lire mesureAt et le dire.
{
  const src = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const i = src.indexOf("function renderTresorerie(");
  const corps = i < 0 ? "" : src.slice(i, src.indexOf("\nfunction ", i + 10));
  verifie("Tresorerie : l age du solde est lu (mesureAt)", /d\.mesureAt/.test(corps), "mesureAt absent de renderTresorerie");
  verifie("Tresorerie : l age est affiche dans le panneau", /\$\{ageSolde\}/.test(corps), "ageSolde non insere");
}

// ================= LE RELEVE DU COMPTE DE RESULTAT ATTEND SES ENTREES
// Mesure en production le 15/09 : 3 des 4 premiers jours figes SANS les primes
// (journal pas encore lu au premier dessin) et le 12/09 SANS le Telegram. Le
// dernier releve d un mois est son resultat final : on ne note plus rien tant
// qu une entree manque, et les chargeurs redessinent le compte de resultat.
{
  let blocP = "";
  try { blocP = morceau("function pnlEntreesManquantes(", "function noterPnl("); } catch (e) {}
  verifie("releve P&L : la garde des entrees existe", !!blocP, "pnlEntreesManquantes absente");
  if (blocP) {
    const faire = (o) => new Function("ONLYCHAT_DATA","ONLYCHAT_NON_BRANCHE","ONLYCHAT_FAILS","tgIncertain","COSTS_LOADED","OM_DATA",
      blocP + "; return pnlEntreesManquantes;")(o.oc, o.nb, o.fails, () => o.incertain, o.couts, o.om)(o.primes, o.rw);
    const tout = { oc: { totalRevenue: 10 }, nb: false, fails: 0, incertain: false, couts: true, om: {}, primes: { total: 0 }, rw: { aAjouter: 0 } };
    const avec = (p) => Object.assign({}, tout, p);
    verifie("releve P&L : tout est la = on note", faire(tout).length === 0, JSON.stringify(faire(tout)));
    verifie("releve P&L : journal des primes pas lu = on attend", faire(avec({ primes: null })).includes("primes"), "releve fige sans les primes");
    verifie("releve P&L : Telegram pas encore arrive = on attend", faire(avec({ oc: null })).includes("telegram"), "releve fige avec Telegram = 0");
    verifie("releve P&L : OnlyChat non branche = la saisie manuelle fait foi", !faire(avec({ oc: null, nb: true })).includes("telegram"), "jamais note sans OnlyChat");
    verifie("releve P&L : OnlyChat lache mais saisie manuelle du mois = on note", !faire(avec({ oc: null, fails: 3, incertain: false })).includes("telegram"), "bloque a tort");
    verifie("releve P&L : OnlyChat lache sans saisie = on attend", faire(avec({ oc: null, fails: 3, incertain: true })).includes("telegram"), "releve sur un Telegram inconnu");
    verifie("releve P&L : facture Railway pas lue = on attend", faire(avec({ rw: null })).includes("railway"), "Railway ignore");
    verifie("releve P&L : couts pas encore lus = on attend", faire(avec({ couts: false })).includes("couts"), "couts ignores");
    verifie("releve P&L : revenus partiels = on attend", faire(avec({ om: { revenusPartiels: true } })).includes("revenus partiels"), "un minimum fige comme resultat");
  }
  const corpsDe = (nom) => {
    const i = src.indexOf("function " + nom + "(");
    if (i < 0) return "";
    const fins = [src.indexOf("\nfunction ", i + 10), src.indexOf("\nasync function ", i + 10)].filter((x) => x > 0);
    return src.slice(i, fins.length ? Math.min(...fins) : i + 6000);
  };
  verifie("releve P&L : renderRenta ne note qu avec toutes les entrees", /pnlEntreesManquantes\(primesMois,_rw\)/.test(corpsDe("renderRenta")), "noterPnl non garde");
  verifie("loadPaieCumul redessine le compte de resultat et les cartes", /renderRenta\(\)/.test(corpsDe("loadPaieCumul")) && /render\(LAST\)/.test(corpsDe("loadPaieCumul")), "primes « — » jusqu au tour suivant");
  verifie("loadRailway redessine le compte de resultat", /renderRenta\(\)/.test(corpsDe("loadRailway")), "facture Railway absente du compte de resultat");
  verifie("OnlyChat non branche est retenu", /ONLYCHAT_NON_BRANCHE=true/.test(src), "drapeau jamais pose");
}

// ================= QUI DEPENSE : DE QUEL BOT VIENT L ARGENT ?
// Demande d Andre le 15/09 : la puce disait « Bot 24 $ » sans dire si c etait le
// bot Insta, Twitter ou TikTok. Le cerveau ventile par plateforme ecrite du lien.
{
  let blocB = "";
  try { blocB = morceau("function persoPucesParBot(", "function ligneModeles("); } catch (e) {}
  verifie("Qui depense : la fonction des puces par bot existe", !!blocB, "persoPucesParBot absente");
  if (blocB) {
    const puces = new Function(blocB + "; return persoPucesParBot;")();
    const pv = { Bot: { display: "Bot", rev: 42, payeurs: 2, parModele: { ModeleA: { rev: 30, payeurs: 1 }, ModeleB: { rev: 12, payeurs: 1 } },
      parPlateforme: { instagram: { rev: 30, payeurs: 1, parModele: { ModeleA: { rev: 30, payeurs: 1 } } },
                       twitter: { rev: 12, payeurs: 1, parModele: { ModeleB: { rev: 12, payeurs: 1 } } } } },
      Clhoe: { display: "Clhoe", rev: 20, payeurs: 1, parModele: { ModeleA: { rev: 20, payeurs: 1 } } } };
    const tout = puces(pv, false, "all");
    verifie("Qui depense : une puce par bot, avec son nom", tout.length === 3 && tout.some(x => x.nom === "Bot" && x.bot === "Insta" && x.rev === 30) && tout.some(x => x.nom === "Bot" && x.bot === "Twitter" && x.rev === 12), JSON.stringify(tout));
    verifie("Qui depense : les puces d un bot additionnent son total", tout.filter(x => x.nom === "Bot").reduce((a, x) => a + x.rev, 0) === 42, "somme fausse");
    verifie("Qui depense : sous chaque bot, le modele de CE bot", (tout.find(x => x.bot === "Insta") || {}).parModele && Object.keys(tout.find(x => x.bot === "Insta").parModele).join() === "ModeleA", "modele melange entre bots");
    verifie("Qui depense : compte sans plateforme ecrite = une puce entiere, sans bot invente", tout.some(x => x.nom === "Clhoe" && x.bot === null), "plateforme devinee");
    const surB = puces(pv, true, "ModeleB");
    verifie("Qui depense : onglet modele = seulement la part de ce modele, par bot", surB.length === 1 && surB[0].bot === "Twitter" && surB[0].rev === 12, JSON.stringify(surB));
    const ancien = puces({ Bot: { display: "Bot", rev: 30, payeurs: 1 } }, false, "all");
    verifie("Qui depense : cerveau pas encore a jour = une puce, comme avant", ancien.length === 1 && ancien[0].bot === null, JSON.stringify(ancien));
    verifie("Qui depense : un bot a 0 $ n affiche pas de puce", puces({ Bot: { display: "Bot", rev: 5, parPlateforme: { instagram: { rev: 5, payeurs: 1 }, twitter: { rev: 0, payeurs: 0 } } } }, false, "all").length === 1, "puce a 0 $");
  }
  verifie("Qui depense : le nom du bot est ecrit sur la puce", /\$\{e\.bot\?` · \$\{escapeHtml\(e\.bot\)\}`:""\}/.test(src), "e.bot jamais affiche");
}

// ================= SANTE DES COMPTES : « SORTIR DES STATS » N ANNONCE QUE CE QUI EST FAIT
// Le 15/09 la seule facon d agir sur un compte suspect etait de le demander a Claude.
// Le bouton ecrit sur les stats d un VA : on verifie qu il n annonce JAMAIS un succes
// sans la reponse du serveur, et qu il n existe pas en vue associe.
{
  let blocX = "";
  try { blocX = morceau("async function exclureCompteSuspect(", "// 📋 NOTE DU JOUR SUR 100"); } catch (e) {}
  verifie("Sortir des stats : le geste existe", !!blocX, "exclureCompteSuspect absente");
  if (blocX) {
    const jouer = async (reponse, confirme) => {
      const toasts = [], appels = []; let relu = 0;
      const f = new Function("SANTEC_DATA", "TOKEN", "HUB_BASE", "confirm", "fetch", "toast", "fmtInt", "loadSanteComptes",
        blocX + "; return exclureCompteSuspect;")(
        { suspects: [{ username: "pagepublique", va: "VaTest", followers: 835203, posts30: 10, vues30: 995477 }] },
        "jeton", "http://x", () => confirme,
        async (u, o) => { appels.push({ u, o }); if (reponse === "reseau") throw new Error("coupure"); return { ok: reponse.status < 400, status: reponse.status, json: async () => reponse.corps }; },
        (a, b) => toasts.push(a + " | " + b), (n) => String(n), async () => { relu++; });
      await f("pagepublique", null);
      return { toasts, appels, relu };
    };
    const ok = await jouer({ status: 200, corps: { ok: true, compte: "@pagepublique", va: "VaTest", postsRetires: 10, postsVaGardes: 0, recalculsEchoues: [] } }, true);
    verifie("Sortir des stats : POST vers la bonne route", ok.appels.length === 1 && /\/api\/hub\/sante-comptes\/exclure$/.test(ok.appels[0].u) && ok.appels[0].o.method === "POST", JSON.stringify(ok.appels.map(a => a.u)));
    verifie("Sortir des stats : succes annonce avec les chiffres du serveur", ok.toasts.length === 1 && /^✅/.test(ok.toasts[0]) && /10 reels retirés/.test(ok.toasts[0]), ok.toasts.join(" // "));
    verifie("Sortir des stats : le panneau se relit apres", ok.relu === 1, "panneau pas relu");
    const refuse = await jouer({ status: 409, corps: { error: "pas un compte suspect" } }, true);
    verifie("Sortir des stats : refus du serveur = « rien n a ete change »", refuse.toasts.length === 1 && /Rien n'a été changé/.test(refuse.toasts[0]) && !/✅/.test(refuse.toasts[0]), refuse.toasts.join(" // "));
    const menteur = await jouer({ status: 200, corps: { error: "bizarre" } }, true);
    verifie("Sortir des stats : 200 sans ok:true n est PAS un succes", !menteur.toasts.some(t => /✅/.test(t)), menteur.toasts.join(" // "));
    const coupe = await jouer("reseau", true);
    verifie("Sortir des stats : coupure = rien n est confirme", coupe.toasts.length === 1 && /Pas de réponse/.test(coupe.toasts[0]), coupe.toasts.join(" // "));
    const annule = await jouer({ status: 200, corps: { ok: true } }, false);
    verifie("Sortir des stats : annuler la confirmation n envoie rien", annule.appels.length === 0 && annule.toasts.length === 0, "requete partie sans confirmation");
  }
  const iR = src.indexOf("function renderSanteComptes(");
  const corpsR = iR < 0 ? "" : src.slice(iR, src.indexOf("\nasync function exclureCompteSuspect(", iR));
  verifie("Sortir des stats : bouton absent en vue associe", /_assocSc\?"":/.test(corpsR) && /classList\.contains\("assoc-mode"\)/.test(corpsR), "bouton d ecriture visible par l associee");
}

console.log(ko? "\n"+ko+" ECHEC(S)" : "\nTOUT PASSE"); process.exit(ko?1:0);
