import { networkInterfaces } from 'node:os';

export function networkAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flatMap(entries => entries || [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.'))
    .map(entry => entry.address))];
}

export function printNetwork(port = process.env.PORT || '3000') {
  const alias = 'nexo.lc';
  const suffix = Number(port) === 80 ? '' : `:${port}`;
  console.log('\n========== NEXO - ACCESO DESDE EL TELEFONO ==========');
  console.log(`Este equipo: http://localhost${suffix}`);
  const addresses = networkAddresses();
  for (const ip of addresses) console.log(`Telefono:    http://${ip}${suffix}`);
  if (!addresses.length) console.log('No se detecto una direccion IPv4 de red. Conecta el equipo al Wi-Fi.');
  console.log(`Alias:       http://${alias}${suffix}`);
  console.log('El telefono y este equipo deben estar en la misma red Wi-Fi.');
  console.log('El alias requiere un registro DNS local nexo.lc -> IP de este equipo');
  console.log('en el router. Sin ese registro, usa la direccion IP de arriba.');
  console.log('Si hay varias IP, elige la del Wi-Fi o Ethernet de tu red.');
  console.log('Si Windows pregunta, permite Node.js en redes privadas.');
  console.log('Ayuda para el alias: ACCESO-TELEFONO.md');
  console.log('===================================================\n');
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) printNetwork();
