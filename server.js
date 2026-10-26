require("dotenv").config();
const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "state.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET || !process.env.OBS_TOKEN) {
  console.error("Configure ADMIN_PASSWORD, SESSION_SECRET e OBS_TOKEN no .env antes de iniciar."); process.exit(1);
}
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const starterPrizes = [
  { label: "Prêmio 1", color: "#f97316" }, { label: "Prêmio 2", color: "#22c55e" },
  { label: "Prêmio 3", color: "#3b82f6" }, { label: "Prêmio 4", color: "#a855f7" },
  { label: "Prêmio 5", color: "#ec4899" }, { label: "Prêmio 6", color: "#eab308" }
];
function makeWheel(id, name, priceCents) { return { id, name, priceCents, prizes: starterPrizes.map(p => ({ id: crypto.randomUUID(), ...p })) }; }
const defaultState = {
  wheels: [makeWheel("basica", "Roleta Básica", 200), makeWheel("insana", "Roleta Insana", 2000), makeWheel("braba", "Roleta Braba", 10000)],
  displayName: "",
  spins: [], processedPaymentIds: [], recentResults: []
};
function writeState(s) { const tmp = DB_FILE + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 }); fs.renameSync(tmp, DB_FILE); }
function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    if (Array.isArray(saved.wheels) && saved.wheels.length) return { ...structuredClone(defaultState), ...saved };
    // Upgrade the previous single-wheel format while preserving its prizes and queue.
    const migrated = structuredClone(defaultState);
    if (Array.isArray(saved.prizes) && saved.prizes.length >= 2) migrated.wheels[0].prizes = saved.prizes;
    if (Number.isInteger(saved.settings?.minimumCents)) migrated.wheels[0].priceCents = saved.settings.minimumCents;
    migrated.spins = (saved.spins || []).map(s => ({ ...s, wheelId: s.wheelId || "basica", test: s.test || false }));
    migrated.processedPaymentIds = saved.processedPaymentIds || []; migrated.recentResults = saved.recentResults || [];
    writeState(migrated); return migrated;
  } catch { const fresh = structuredClone(defaultState); writeState(fresh); return fresh; }
}
let state = readState();
function safeEqual(a,b) { const aa=Buffer.from(String(a||"")),bb=Buffer.from(String(b||"")); return aa.length===bb.length && crypto.timingSafeEqual(aa,bb); }
app.use(express.json({ limit: "100kb" }));
app.use(session({ name:"roleta.sid", secret:process.env.SESSION_SECRET, resave:false, saveUninitialized:false, cookie:{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:8*60*60*1000} }));
app.use(express.static(path.join(__dirname,"public"),{index:"index.html"}));
function requireAdmin(req,res,next){ if(req.session?.admin===true)return next(); return res.status(401).json({error:"Faça login novamente."}); }
function requireObs(req,res,next){ if(safeEqual(req.query.token,process.env.OBS_TOKEN))return next(); return res.status(403).send("Token OBS inválido."); }
function getWheel(id){ return state.wheels.find(w=>w.id===id); }
app.post("/api/login",(req,res)=>{const {username,password}=req.body||{};if(safeEqual(username,process.env.ADMIN_USER||"admin")&&safeEqual(password,process.env.ADMIN_PASSWORD)){req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Não foi possível iniciar sessão."});req.session.admin=true;res.json({ok:true});});}else res.status(401).json({error:"Usuário ou senha incorretos."});});
app.post("/api/logout",requireAdmin,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/me",(req,res)=>res.json({authenticated:req.session?.admin===true}));
app.get("/api/admin/state",requireAdmin,(req,res)=>res.json({wheels:state.wheels,displayName:state.displayName||"",pendingSpins:state.spins.length,recentResults:state.recentResults.slice(0,30)}));
app.put("/api/admin/branding",requireAdmin,(req,res)=>{state.displayName=String(req.body?.displayName||"").trim().slice(0,40);writeState(state);res.json({ok:true,displayName:state.displayName});});
app.put("/api/admin/wheels",requireAdmin,(req,res)=>{
 const incoming=req.body?.wheels;
 if(!Array.isArray(incoming)||incoming.length<1||incoming.length>10)return res.status(400).json({error:"Cadastre de 1 a 10 roletas."});
 const ids=new Set(),clean=[];
 for(const w of incoming){const id=String(w.id||"");const name=String(w.name||"").trim().slice(0,50);const priceCents=Number(w.priceCents);if(!id||ids.has(id)||!name)return res.status(400).json({error:"Cada roleta precisa ter um nome e identificador único."});ids.add(id);if(!Number.isInteger(priceCents)||priceCents<100||priceCents>100000000)return res.status(400).json({error:`O preço de ${name} precisa ser entre R$ 1,00 e R$ 1.000.000,00.`});if(!Array.isArray(w.prizes)||w.prizes.length<2||w.prizes.length>24)return res.status(400).json({error:`${name}: informe de 2 a 24 prêmios.`});const prizes=[];for(const p of w.prizes){const label=String(p.label||"").trim().slice(0,70);if(!label)return res.status(400).json({error:`Todos os prêmios de ${name} precisam ter nome.`});prizes.push({id:String(p.id||crypto.randomUUID()),label,color:/^#[0-9a-fA-F]{6}$/.test(p.color)?p.color:"#f97316"});}clean.push({id,name,priceCents,prizes});}
 state.wheels=clean;writeState(state);res.json({ok:true,wheels:state.wheels});
});
function enqueueSpin({donor,source,wheelId,test=false}){const wheel=getWheel(wheelId)||state.wheels[0];const prizeIndex=Math.floor(Math.random()*wheel.prizes.length);const prize=wheel.prizes[prizeIndex];const spin={id:crypto.randomUUID(),donor:String(donor||"Apoiador").slice(0,50),source,wheelId:wheel.id,wheelName:wheel.name,prizeIndex,prizeLabel:prize.label,test,queuedAt:new Date().toISOString()};state.spins.push(spin);writeState(state);return spin;}
app.post("/api/admin/cancel-tests",requireAdmin,(req,res)=>{
 const before=state.spins.length;
 state.spins=state.spins.filter(s=>!(s.test || /teste/i.test(String(s.source||"")) || /teste/i.test(String(s.donor||""))));
 const canceled=before-state.spins.length;writeState(state);res.json({ok:true,canceled,pendingSpins:state.spins.length});
});
app.post("/api/admin/test-spin",requireAdmin,(req,res)=>{const wheel=getWheel(String(req.body?.wheelId||""));if(!wheel)return res.status(400).json({error:"Escolha uma roleta válida para testar."});
 // Testes antigos podem ficar presos na fila; descarte apenas testes pendentes e preserve giros pagos.
 state.spins=state.spins.filter(s=>!(s.test || /teste/i.test(String(s.source||"")) || /teste/i.test(String(s.donor||""))));
 const spin=enqueueSpin({donor:"TESTE GRÁTIS",source:"teste manual",wheelId:wheel.id,test:true});
 res.json({ok:true,queued:state.spins.length,spinId:spin.id,wheelId:wheel.id});});
app.get("/overlay/state",requireObs,(req,res)=>res.json({wheels:state.wheels,displayName:state.displayName||"",spins:state.spins.slice(0,10),latest:state.recentResults[0]||null,pendingSpins:state.spins.length}));
app.post("/overlay/complete",requireObs,(req,res)=>{const spinId=String(req.body?.spinId||"");const idx=state.spins.findIndex(s=>s.id===spinId);if(idx<0)return res.status(404).json({error:"Giro não encontrado."});const spin=state.spins.splice(idx,1)[0];const result={id:spin.id,donor:spin.donor,prize:spin.prizeLabel,wheelName:spin.wheelName,test:spin.test,completedAt:new Date().toISOString()};state.recentResults.unshift(result);state.recentResults=state.recentResults.slice(0,50);writeState(state);res.json({ok:true,result});});
let tokenCache={token:null,expiresAt:0};
async function livePixToken(){if(tokenCache.token&&Date.now()<tokenCache.expiresAt-60000)return tokenCache.token;const id=process.env.LIVEPIX_CLIENT_ID,secret=process.env.LIVEPIX_CLIENT_SECRET;if(!id||!secret)throw new Error("Credenciais LivePix não configuradas.");const form=new URLSearchParams({grant_type:"client_credentials",client_id:id,client_secret:secret,scope:process.env.LIVEPIX_SCOPES||"wallet:read webhooks"});const response=await fetch("https://oauth.livepix.gg/oauth2/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});const data=await response.json().catch(()=>({}));if(!response.ok||!data.access_token)throw new Error("Falha ao obter token LivePix (HTTP "+response.status+"). Confira credenciais e permissões.");tokenCache={token:data.access_token,expiresAt:Date.now()+Number(data.expires_in||3600)*1000};return tokenCache.token;}
async function getVerifiedPayment(paymentId){const token=await livePixToken();const response=await fetch("https://api.livepix.gg/v2/payments/"+encodeURIComponent(paymentId),{headers:{Authorization:"Bearer "+token,Accept:"application/json"}});const data=await response.json().catch(()=>({}));if(!response.ok||!data.data)throw new Error("Não foi possível confirmar pagamento pela API (HTTP "+response.status+").");return data.data;}
app.post("/webhook/livepix",async(req,res)=>{try{const body=req.body||{},expected=process.env.LIVEPIX_EXPECTED_CLIENT_ID||process.env.LIVEPIX_CLIENT_ID;if(!expected||!safeEqual(body.clientId,expected))return res.status(403).json({error:"clientId não reconhecido."});if(body.event!=="new"||body.resource?.type!=="payment"||!body.resource?.id)return res.status(200).json({ok:true,ignored:true});const paymentId=String(body.resource.id);if(state.processedPaymentIds.includes(paymentId))return res.status(200).json({ok:true,duplicate:true});const payment=await getVerifiedPayment(paymentId);if(payment.currency!=="BRL"||!Number.isFinite(Number(payment.amount)))return res.status(200).json({ok:true,ignored:true});const amountCents=Number(payment.amount);const affordable=state.wheels.filter(w=>amountCents>=w.priceCents).sort((a,b)=>b.priceCents-a.priceCents);let count=0,wheel=null;if(affordable.length){wheel=affordable[0];count=Math.min(Math.floor(amountCents/wheel.priceCents),100);for(let i=0;i<count;i++)enqueueSpin({donor:"Apoiador",source:"LivePix",wheelId:wheel.id});}state.processedPaymentIds.push(paymentId);state.processedPaymentIds=state.processedPaymentIds.slice(-5000);writeState(state);return res.status(200).json({ok:true,spins:count,wheel:wheel?.name||null});}catch(err){console.error("Webhook LivePix:",err.message);return res.status(500).json({error:"Falha ao processar webhook. O LivePix poderá tentar novamente."});}});
app.get("/health",(_req,res)=>res.json({ok:true}));
app.listen(PORT,()=>console.log(`Roleta rodando em http://localhost:${PORT}`));
