const waiting=document.querySelector("#waiting"), reveal=document.querySelector("#reveal"), person=document.querySelector("#person"), phrase=document.querySelector("#phrase"), countdown=document.querySelector("#countdown"), queueLabel=document.querySelector("#queue");
let currentId=null, countdownTimer=null, qrMade=false;
async function setupQR(){
  try{
    const r=await fetch("/api/config"); const config=await r.json();
    if(window.QRCode){new QRCode(document.querySelector("#qr"),{text:config.joinUrl,width:300,height:300,colorDark:"#000000",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});qrMade=true;}
    else {document.querySelector("#qr").textContent="No se pudo cargar el generador QR. Revisa la conexión a internet.";}
  }catch(e){document.querySelector("#qr").textContent="No se pudo cargar el QR.";}
}
function showState(state){
  queueLabel.textContent=state.waiting?`En espera: ${state.waiting}`:"";
  if(!state.active){
    currentId=null; clearInterval(countdownTimer); countdown.textContent="";
    reveal.classList.add("hidden");waiting.classList.remove("hidden");return;
  }
  if(currentId!==state.active.id){
    currentId=state.active.id; person.textContent=state.active.name; phrase.textContent=`«${state.active.phrase}»`;
    waiting.classList.add("hidden");reveal.classList.remove("hidden");
    reveal.classList.remove("revealAnim");void reveal.offsetWidth;reveal.classList.add("revealAnim");
  }
  const tick=()=>{const remaining=Math.max(0,Math.ceil((state.active.startedAt+state.active.durationMs-Date.now())/1000));countdown.textContent=`Siguiente aparición en ${remaining}s`;};
  clearInterval(countdownTimer);tick();countdownTimer=setInterval(tick,250);
}
const socket=io();
socket.on("state",showState);
setupQR();
