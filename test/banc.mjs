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
      return Promise.resolve(new Response("{}", {status: interdit?403:200})); } };
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

  // un POST refuse ne doit pas condamner le GET du meme chemin
  appels=[];
  await faux.fetch("https://cerveau/api/hub/tasks", {method:"POST"});
  const r2 = await faux.fetch("https://cerveau/api/hub/tasks");
  V("un POST refuse n interdit pas le GET du meme chemin", appels.length===2, "le GET a ete etouffe par le refus du POST");
}

console.log(ko? "\n"+ko+" ECHEC(S)" : "\nTOUT PASSE"); process.exit(ko?1:0);
