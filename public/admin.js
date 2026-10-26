const $ = s => document.querySelector(s);
let wheels = [];
async function api(url, options={}) {
  const response = await fetch(url, { credentials:"same-origin", headers:{"Content-Type":"application/json", ...(options.headers||{})}, ...options });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || `Erro HTTP ${response.status}`);
  return data;
}
function showMessage(message,error=false){$("#adminMessage").textContent=message;$("#adminMessage").style.color=error?"#fca5a5":"#86efac";}
function money(cents){return (cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});}
function renderWheels(){
 const list=$("#wheelList");list.innerHTML="";
 wheels.forEach((w,wi)=>{
  const card=document.createElement("section");card.className="wheelCard";
  const head=document.createElement("div");head.className="wheelEditHead";
  const name=document.createElement("input");name.value=w.name;name.maxLength=50;name.setAttribute("aria-label","Nome da roleta");name.oninput=()=>w.name=name.value;
  const priceLabel=document.createElement("label");priceLabel.textContent="Preço por giro (R$)";
  const price=document.createElement("input");price.type="number";price.min="1";price.step="0.01";price.value=(w.priceCents/100).toFixed(2);price.setAttribute("aria-label","Preço por giro");price.onchange=()=>w.priceCents=Math.round(Number(price.value)*100);
  priceLabel.append(price);
  const delWheel=document.createElement("button");delWheel.className="remove";delWheel.textContent="Excluir roleta";delWheel.disabled=wheels.length<=1;delWheel.onclick=()=>{if(wheels.length<=1)return;wheels.splice(wi,1);renderWheels();};
  head.append(name,priceLabel,delWheel);card.append(head);
  const sub=document.createElement("div");sub.className="wheelSubhead";const title=document.createElement("strong");title.textContent=`Prêmios (${w.prizes.length})`;const add=document.createElement("button");add.className="secondary";add.textContent="+ Prêmio";add.onclick=()=>{if(w.prizes.length>=24)return showMessage("Limite de 24 prêmios por roleta.",true);w.prizes.push({id:crypto.randomUUID(),label:"Novo prêmio",color:"#06b6d4"});renderWheels();};sub.append(title,add);card.append(sub);
  const prizes=document.createElement("div");prizes.className="prizeList";
  w.prizes.forEach((p,pi)=>{const row=document.createElement("div");row.className="prizeRow";const num=document.createElement("span");num.className="muted";num.textContent=String(pi+1).padStart(2,"0");const label=document.createElement("input");label.value=p.label;label.maxLength=70;label.setAttribute("aria-label","Nome do prêmio");label.oninput=()=>p.label=label.value;const color=document.createElement("input");color.type="color";color.value=p.color;color.setAttribute("aria-label","Cor do prêmio");color.oninput=()=>p.color=color.value;const del=document.createElement("button");del.className="remove";del.textContent="×";del.title="Remover prêmio";del.onclick=()=>{if(w.prizes.length<=2)return showMessage("Cada roleta precisa ter pelo menos dois prêmios.",true);w.prizes.splice(pi,1);renderWheels();};row.append(num,label,color,del);prizes.append(row);});card.append(prizes);
  const test=document.createElement("button");test.className="secondary testWheel";test.textContent=`🎯 Testar ${w.name||"esta roleta"} grátis`;test.onclick=async()=>{try{await api("/api/admin/test-spin",{method:"POST",body:JSON.stringify({wheelId:w.id})});showMessage(`Teste grátis de “${w.name}” colocado na fila.`);await refresh();}catch(e){showMessage(e.message,true);}};card.append(test);list.append(card);
 });
 $("#wheelCount").textContent=wheels.length;$("#prizeCount").textContent=wheels.reduce((n,w)=>n+w.prizes.length,0);
}
function renderHistory(results){const history=$("#history");history.innerHTML="";if(!results.length){history.textContent="Nenhum giro ainda.";return;}results.forEach(r=>{const row=document.createElement("div");row.className="historyItem";const a=document.createElement("span");a.textContent=`${r.donor} · ${r.wheelName||"Roleta"}${r.test?" (teste grátis)":""}`;const b=document.createElement("strong");b.textContent=`Caiu: ${r.prize}`;row.append(a,b);history.append(row);});}
async function refreshDashboard(){const d=await api("/api/admin/state");$("#queueCount").textContent=d.pendingSpins;renderHistory(d.recentResults||[]);}
async function refresh(){const d=await api("/api/admin/state");wheels=d.wheels;$("#displayNameInput").value=d.displayName||"";$("#queueCount").textContent=d.pendingSpins;renderWheels();renderHistory(d.recentResults||[]);$("#overlayUrl").textContent=location.origin+"/overlay.html?token=COLOQUE_SEU_OBS_TOKEN";}
async function checkLogin(){try{const d=await api("/api/me");$("#loginPanel").hidden=d.authenticated;$("#adminPanel").hidden=!d.authenticated;if(d.authenticated)await refresh();}catch{}}
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();$("#loginError").textContent="";const fd=new FormData(e.target);try{await api("/api/login",{method:"POST",body:JSON.stringify({username:fd.get("username"),password:fd.get("password")})});await checkLogin();}catch(err){$("#loginError").textContent=err.message;}});
$("#logout").onclick=async()=>{await api("/api/logout",{method:"POST"});$("#adminPanel").hidden=true;$("#loginPanel").hidden=false;};
$("#addWheel").onclick=()=>{if(wheels.length>=10)return showMessage("Limite de 10 roletas.",true);wheels.push({id:crypto.randomUUID(),name:"Nova roleta",priceCents:500,prizes:[{id:crypto.randomUUID(),label:"Prêmio 1",color:"#06b6d4"},{id:crypto.randomUUID(),label:"Prêmio 2",color:"#22c55e"}]});renderWheels();};
$("#saveWheels").onclick=async()=>{try{const d=await api("/api/admin/wheels",{method:"PUT",body:JSON.stringify({wheels})});wheels=d.wheels;renderWheels();showMessage("Roletas, preços e prêmios salvos!");}catch(e){showMessage(e.message,true);}};
$("#copyUrl").onclick=async()=>{try{await navigator.clipboard.writeText($("#overlayUrl").textContent);showMessage("URL copiada.");}catch{showMessage("Copie a URL manualmente após configurar o token.",true);}};
$("#cancelTests").onclick=async()=>{try{const d=await api("/api/admin/cancel-tests",{method:"POST"});showMessage(d.canceled?`${d.canceled} teste(s) pendente(s) cancelado(s).`:"Não havia testes pendentes.");await refresh();}catch(e){showMessage(e.message,true);}};
$("#saveBranding").onclick=async()=>{try{const d=await api("/api/admin/branding",{method:"PUT",body:JSON.stringify({displayName:$("#displayNameInput").value})});$("#brandingMessage").textContent=d.displayName?`Nome salvo: ${d.displayName}`:"Nome removido; será exibido SUA ROLETA.";$("#brandingMessage").style.color="#67e8f9";}catch(e){$("#brandingMessage").textContent=e.message;}};
checkLogin();

// Atualiza fila e resultado automaticamente sem reconstruir os campos que o streamer está editando.
setInterval(()=>{if(!$("#adminPanel").hidden)refreshDashboard().catch(()=>{});},2000);
