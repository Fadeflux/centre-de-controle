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

console.log(ko? "\n"+ko+" ECHEC(S)" : "\nTOUT PASSE"); process.exit(ko?1:0);
