import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

test('conserva contexto entre modelos, oculta claves y persiste después de reiniciar', async () => {
  const received = [];
  const mock = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); received.push(payload);
    res.setHeader('Content-Type', 'application/json');
    if (payload.model === 'falla') { res.writeHead(400); res.end(JSON.stringify({ error: 'contexto demasiado largo' })); }
    else if (payload.model === 'truncado') res.end(JSON.stringify({ choices: [{ message: { content: 'Respuesta incompleta' }, finish_reason: 'length' }], usage: { completion_tokens: 2000 } }));
    else if (payload.model === 'sin-texto') res.end(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }));
    else if (payload.messages[0].content.startsWith('Resume la conversación')) res.end(JSON.stringify({ choices: [{ message: { content: 'Ana: proyecto.' }, finish_reason: 'stop' }] }));
    else res.end(JSON.stringify({ choices: [{ message: { content: `Respuesta ${received.length}` } }], ...(payload.model === 'modelo-a' ? { usage: { completion_tokens: 20 } } : {}) }));
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const dir = await mkdtemp(path.join(tmpdir(), 'nexo-test-'));
  let child; let port; let token;
  async function start() {
    // Reserve an available port, then hand it to the child process.
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    child = spawn(process.execPath, ['--experimental-strip-types', 'server.ts'], { cwd: process.cwd(), env: { ...process.env, HOST: '0.0.0.0', PORT: String(port), NEXO_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 100; i++) {
      try { const state = await request('state'); token = state.token; return state; } catch { await new Promise(r => setTimeout(r, 50)); }
    }
    throw new Error('El servidor no inició.');
  }
  async function stop() { if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } }
  async function request(route, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${port}/api/${route}`, { method, headers: { 'Content-Type': 'application/json', 'X-Chat-Token': token || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  }
  try {
    await start();
    const lan = Object.values(networkInterfaces()).flatMap(entries => entries || []).find(entry => entry.family === 'IPv4' && !entry.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address));
    if (lan) {
      const response = await fetch(`http://${lan.address}:${port}/api/state`, { signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200, 'El servidor debe aceptar conexiones por la IP de red');
      assert.equal((await response.json()).token, token);
    }
    const p1 = await request('providers', 'POST', { name: 'Uno', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, model: 'modelo-a', apiKey: 'clave-secreta' });
    assert.equal(p1.apiKey, undefined); assert.equal(p1.hasKey, true);
    assert.equal(p1.maxResponseTokens, undefined); assert.equal(p1.optimization, 'adaptive');
    const p2 = await request('providers', 'POST', { name: 'Dos', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, model: 'modelo-b', apiKey: '' });
    const chat = await request('chats', 'POST', {});
    await request(`chats/${chat.id}`, 'PATCH', { context: 'Mi nombre es Ana.' });
    await request(`chats/${chat.id}/messages`, 'POST', { providerId: p1.id, content: 'Recuerda mi proyecto.' });
    await request(`chats/${chat.id}/messages`, 'POST', { providerId: p2.id, content: 'Continúa.' });
    assert.equal(received[1].model, 'modelo-b');
    assert.ok(received[1].messages[0].content.startsWith('Mi nombre es Ana.'));
    assert.match(received[1].messages[0].content, /Responde directamente/);
    assert.equal(received[1].max_tokens, undefined);
    assert.equal(received[1].max_completion_tokens, undefined);
    assert.deepEqual(received[1].messages.slice(1), [ { role: 'user', content: 'Recuerda mi proyecto.' }, { role: 'assistant', content: 'Respuesta 1' }, { role: 'user', content: 'Continúa.' } ]);
    await request('providers', 'POST', { ...p2, model: 'falla' });
    await assert.rejects(request(`chats/${chat.id}/messages`, 'POST', { providerId: p2.id, content: 'Mensaje fallido' }), /400/);
    await stop();
    const state = await start();
    assert.equal(state.chats[0].context, 'Mi nombre es Ana.');
    assert.equal(state.chats[0].messages.length, 4);
    assert.equal(state.chats[0].messages[1].metrics.tokens, 20);
    assert.equal(state.chats[0].messages[1].metrics.estimated, false);
    assert.equal(state.chats[0].messages[3].metrics.estimated, true);
    assert.ok(state.chats[0].messages[1].metrics.tokensPerSecond > 0);
    assert.equal(JSON.stringify(state).includes('clave-secreta'), false);
    const forbidden = await fetch(`http://127.0.0.1:${port}/api/chats`, { method: 'POST', body: '{}' });
    assert.equal(forbidden.status, 403);
    await assert.rejects(request(`chats/${chat.id}/compact`, 'POST', { providerId: p1.id }), /más historial/);
    await assert.rejects(request('providers', 'POST', { ...p1, contextWindow: 10 }), /ventana de contexto/);
    const original = (await request('state')).chats[0].messages;
    await request(`chats/${chat.id}/messages`, 'POST', { providerId: p1.id, content: 'Información importante. '.repeat(1500) });
    await request(`chats/${chat.id}/messages`, 'POST', { providerId: p1.id, content: 'Última consulta.' });
    // A provider error must not partially commit a summary.
    await assert.rejects(request(`chats/${chat.id}/compact`, 'POST', { providerId: p2.id }), /400/);
    assert.equal((await request('state')).chats[0].summary, undefined);
    const compacted = await request(`chats/${chat.id}/compact`, 'POST', { providerId: p1.id });
    assert.equal(compacted.messages.length, 8);
    assert.equal(compacted.compactedThrough, 4);
    assert.deepEqual(compacted.messages.slice(0, 4), original);
    assert.match(compacted.summary, /Ana/);
    await request('providers', 'POST', { ...p2, model: 'modelo-b', contextWindow: 65536 });
    await request(`chats/${chat.id}/messages`, 'POST', { providerId: p2.id, content: 'Continúa usando el resumen.' });
    const last = received.at(-1);
    assert.equal(last.model, 'modelo-b');
    assert.ok(last.messages[0].content.startsWith('Mi nombre es Ana.'));
    assert.match(last.messages[1].content, /Resumen de mensajes anteriores/);
    assert.equal(last.messages.length, 7);
    assert.ok(last.messages[2].content === 'Información importante. '.repeat(1500).trim());
    const callsBefore = received.length;
    const twice = await request(`chats/${chat.id}/compact`, 'POST', { providerId: p1.id });
    assert.equal(twice.compactedThrough, 6);
    assert.equal(twice.messages.length, 10);
    assert.ok(received.length - callsBefore >= 3, 'El historial extenso se resume en fragmentos');
    await stop();
    const restored = await start();
    assert.equal(restored.chats[0].compactedThrough, 6);
    assert.equal(restored.chats[0].summary, compacted.summary);
    assert.equal(restored.chats[0].messages.length, 10);
    assert.equal(restored.providers.find(p => p.id === p2.id).contextWindow, 65536);
    await assert.rejects(request('providers', 'POST', { ...p1, optimization: 'unknown' }), /optimización inválido/);
    await request('providers', 'POST', { ...p1, model: 'truncado', optimization: 'off' });
    const limited = await request(`chats/${chat.id}/messages`, 'POST', { providerId: p1.id, content: 'Prueba corta.' });
    assert.equal(received.at(-1).max_tokens, undefined);
    assert.equal(received.at(-1).messages[0].content, 'Mi nombre es Ana.');
    assert.equal(limited.messages.at(-1).truncated, true);
    assert.equal(limited.messages.at(-1).outputLimit, undefined);
    assert.equal(limited.messages.at(-1).metrics.tokens, 2000, 'No se recorta la salida ni su conteo');
    await request('providers', 'POST', { ...p1, model: 'sin-texto' });
    await assert.rejects(request(`chats/${chat.id}/messages`, 'POST', { providerId: p1.id, content: 'Sin salida.' }), /proveedor alcanzó su límite/);
    assert.equal((await request('state')).chats[0].messages.length, limited.messages.length);
    await stop();
    // Existing installations must lose the old cap, not just new providers.
    const old = JSON.parse(await readFile(path.join(dir, 'database.json'), 'utf8'));
    const legacy = old.providers.find(p => p.id === p1.id);
    delete legacy.optimization; legacy.maxResponseTokens = 600; legacy.concise = true;
    await writeFile(path.join(dir, 'database.json'), JSON.stringify(old));
    const savedLimits = await start();
    assert.equal(savedLimits.providers.find(p => p.id === p1.id).maxResponseTokens, undefined);
    assert.equal(savedLimits.providers.find(p => p.id === p1.id).optimization, 'adaptive');
    const migrated = JSON.parse(await readFile(path.join(dir, 'database.json'), 'utf8')).providers.find(p => p.id === p1.id);
    assert.equal(migrated.maxResponseTokens, undefined);
    assert.equal(savedLimits.chats[0].messages.at(-1).truncated, true);
    const benchmarkStart = received.length;
    const benchmark = spawn(process.execPath, ['scripts/benchmark.mjs', '--provider', p2.id], { env: { ...process.env, NEXO_DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    let benchmarkLog = ''; benchmark.stdout.on('data', chunk => benchmarkLog += chunk); benchmark.stderr.on('data', chunk => benchmarkLog += chunk);
    assert.equal((await once(benchmark, 'exit'))[0], 0, benchmarkLog);
    const evaluated = received.slice(benchmarkStart);
    assert.equal(evaluated.length, 6);
    for (const item of evaluated) assert.equal(item.max_tokens, undefined);
    for (let i = 0; i < evaluated.length; i += 2) {
      assert.deepEqual(evaluated[i].messages.slice(1), evaluated[i + 1].messages.slice(1), 'A/B conserva el pedido y el historial');
      assert.equal(evaluated[i].model, evaluated[i + 1].model);
    }
    const reports = await readdir(path.join(dir, 'evaluations'));
    const report = JSON.parse(await readFile(path.join(dir, 'evaluations', reports[0]), 'utf8'));
    assert.equal(report.results.length, 3);
    assert.ok(report.results.every(r => r.baseline.text && r.optimized.text && r.qualityReview));
    assert.equal((await request('state')).chats[0].messages.length, limited.messages.length, 'El benchmark no modifica el chat');
  } finally { await stop(); await new Promise(resolve => mock.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});
