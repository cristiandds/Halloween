const { test } = require('node:test');
const assert = require('node:assert');
const { handler: stateHandler } = require('../netlify/functions/state');
const { handler: submitHandler } = require('../netlify/functions/submit');
const { handler: participantHandler } = require('../netlify/functions/participant');
const { clearQueue, loadRawState, saveRawState } = require('../netlify/functions/lib/store');

test('Escenario Realista de Proyección: Flujo completo de celulares y pantalla LED', async () => {
  await clearQueue();

  // 1. La pantalla LED aún NO está abierta (pantalla desconectada)
  // Tres invitados escanean el QR desde sus celulares e ingresan sus nombres en orden:
  // Invitado 1: Drácula
  const res1 = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '10.0.0.1' },
    body: JSON.stringify({ name: 'Dracula' })
  });
  assert.strictEqual(res1.statusCode, 200);
  const data1 = JSON.parse(res1.body);
  assert.strictEqual(data1.isActive, false, 'Celular 1: NO debe mostrar EN PANTALLA al registrar');
  assert.strictEqual(data1.status, 'waiting');
  assert.strictEqual(data1.position, 1, 'Celular 1: Debe ser #1 en cola');

  // Invitado 2: Frankenstein
  const res2 = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '10.0.0.2' },
    body: JSON.stringify({ name: 'Frankenstein' })
  });
  const data2 = JSON.parse(res2.body);
  assert.strictEqual(data2.isActive, false, 'Celular 2: NO debe mostrar EN PANTALLA');
  assert.strictEqual(data2.position, 2, 'Celular 2: Debe ser #2 en cola');

  // Invitado 3: Hombre Lobo
  const res3 = await submitHandler({
    httpMethod: 'POST',
    headers: { 'client-ip': '10.0.0.3' },
    body: JSON.stringify({ name: 'Hombre Lobo' })
  });
  const data3 = JSON.parse(res3.body);
  assert.strictEqual(data3.isActive, false);
  assert.strictEqual(data3.position, 3);

  // 2. Verificar estado desde los 3 celulares mientras la pantalla sigue desconectada:
  // Todos deben seguir en cola, ninguno en pantalla
  const p1Status = JSON.parse((await participantHandler({ queryStringParameters: { id: data1.id } })).body);
  assert.strictEqual(p1Status.state, 'waiting');
  assert.strictEqual(p1Status.position, 1);

  const p2Status = JSON.parse((await participantHandler({ queryStringParameters: { id: data2.id } })).body);
  assert.strictEqual(p2Status.state, 'waiting');
  assert.strictEqual(p2Status.position, 2);

  const p3Status = JSON.parse((await participantHandler({ queryStringParameters: { id: data3.id } })).body);
  assert.strictEqual(p3Status.state, 'waiting');
  assert.strictEqual(p3Status.position, 3);

  // 3. El VJ abre Resolume Arena y carga la URL de proyección /screen
  // Llega el primer ping de la pantalla:
  const screenPing1 = JSON.parse((await stateHandler({ queryStringParameters: { role: 'screen' } })).body);
  assert.strictEqual(screenPing1.status, 'active');
  assert.strictEqual(screenPing1.active.name, 'Dracula', 'Drácula debe ser el primero en mostrarse');
  assert.strictEqual(screenPing1.timeRemaining, 15, 'Drácula debe iniciar con sus 15 segundos reales');
  assert.strictEqual(screenPing1.waiting, 2, 'Quedan 2 en espera: Frankenstein y Hombre Lobo');

  // Ahora el celular de Drácula consulta su estado:
  const p1ActiveStatus = JSON.parse((await participantHandler({ queryStringParameters: { id: data1.id } })).body);
  assert.strictEqual(p1ActiveStatus.state, 'active', 'Celular 1: Ahora sí está EN PANTALLA');
  assert.strictEqual(p1ActiveStatus.remainingSeconds, 15);

  // El celular de Frankenstein consulta su estado:
  const p2WaitingStatus = JSON.parse((await participantHandler({ queryStringParameters: { id: data2.id } })).body);
  assert.strictEqual(p2WaitingStatus.state, 'waiting');
  assert.strictEqual(p2WaitingStatus.position, 1, 'Frankenstein es el próximo');

  // 4. Pasan 15 segundos reales en la pantalla
  let raw = await loadRawState();
  raw.active.startedAt = Date.now() - 15100;
  await saveRawState(raw);

  // La pantalla hace su siguiente sondeo automático:
  const screenPing2 = JSON.parse((await stateHandler({ queryStringParameters: { role: 'screen' } })).body);
  assert.strictEqual(screenPing2.status, 'active');
  assert.strictEqual(screenPing2.active.name, 'Frankenstein', 'Avanza automáticamente al segundo en orden de llegada');
  assert.strictEqual(screenPing2.timeRemaining, 15, 'Frankenstein inicia sus 15 segundos');

  // Estado en celulares tras 15s:
  // Drácula ya finalizó:
  assert.strictEqual(JSON.parse((await participantHandler({ queryStringParameters: { id: data1.id } })).body).state, 'completed');
  // Frankenstein está en pantalla:
  assert.strictEqual(JSON.parse((await participantHandler({ queryStringParameters: { id: data2.id } })).body).state, 'active');
  // Hombre Lobo es el siguiente:
  assert.strictEqual(JSON.parse((await participantHandler({ queryStringParameters: { id: data3.id } })).body).state, 'waiting');

  // 5. Pasan otros 15 segundos para Frankenstein
  raw = await loadRawState();
  raw.active.startedAt = Date.now() - 15100;
  await saveRawState(raw);

  // La pantalla sondea y muestra a Hombre Lobo:
  const screenPing3 = JSON.parse((await stateHandler({ queryStringParameters: { role: 'screen' } })).body);
  assert.strictEqual(screenPing3.active.name, 'Hombre Lobo');
  assert.strictEqual(screenPing3.waiting, 0, 'No quedan más nombres en espera');

  // 6. Pasan los 15 segundos de Hombre Lobo
  raw = await loadRawState();
  raw.active.startedAt = Date.now() - 15100;
  await saveRawState(raw);

  // La pantalla sondea: la cola está vacía -> Regresa automáticamente al QR
  const screenPing4 = JSON.parse((await stateHandler({ queryStringParameters: { role: 'screen' } })).body);
  assert.strictEqual(screenPing4.status, 'qr');
  assert.strictEqual(screenPing4.active, null, 'No hay participante activo');
  assert.strictEqual(screenPing4.waiting, 0);

  // Estado del último celular:
  assert.strictEqual(JSON.parse((await participantHandler({ queryStringParameters: { id: data3.id } })).body).state, 'completed');
});
