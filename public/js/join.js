const form=document.querySelector("#form"), nameInput=document.querySelector("#name"), button=document.querySelector("#send"), result=document.querySelector("#result");
form.addEventListener("submit",async e=>{
  e.preventDefault(); button.disabled=true; result.textContent="Enviando tu nombre...";
  try{
    const response=await fetch("/api/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:nameInput.value})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||"No se pudo enviar.");
    result.textContent=data.position<=1?"¡Prepárate! Tu nombre aparecerá en pantalla.":`¡Listo! Tu nombre está en la cola. Posición aproximada: ${data.position}.`;
    nameInput.value="";
  }catch(err){result.textContent=err.message;}
  finally{button.disabled=false;}
});
