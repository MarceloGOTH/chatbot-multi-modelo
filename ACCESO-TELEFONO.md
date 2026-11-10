# Abrir Nexo desde el teléfono

1. Conecta el teléfono y el PC a la misma red Wi-Fi. El PC también puede estar conectado por cable al mismo router.
2. Detén cualquier servidor anterior con `Ctrl+C` y abre `iniciar-chatbot.bat`.
3. En la ventana verás **Teléfono: http://IP-DEL-PC:3000**. Abre esa dirección en el navegador del teléfono. Si aparecen varias IP, usa la de tu conexión Wi-Fi o Ethernet, no la de una VPN o adaptador virtual.
4. Si Windows solicita permiso para Node.js, permite el acceso en redes privadas. Si el acceso sigue bloqueado, revisa el firewall y que el router no aísle los dispositivos de la red de invitados.

Los modelos locales siguen ejecutándose en el PC. No cambies las URLs de Ollama o LM Studio a la IP del teléfono: las conexiones a los modelos se hacen desde el servidor Node.

## Usar el alias nexo.lc

El iniciador muestra **http://nexo.lc:3000**. Para que funcione en el teléfono necesitas resolver ese nombre en tu red; un archivo `.bat` no puede configurar por sí solo el DNS del teléfono o de tu router.

En la administración del router:

1. Reserva la IP del PC mediante una reserva DHCP, para que no cambie al reiniciar.
2. Busca la opción de registros DNS locales o nombres de host locales. Crea un registro **A** con nombre `nexo.lc` y valor igual a la IP del PC que muestra el iniciador. El DNS no lleva `http://` ni puerto.
3. Asegúrate de que el teléfono use el DNS del router. Un DNS privado, una VPN o un DNS seguro del navegador pueden omitir ese registro local. Reconecta el Wi-Fi tras cambiar la configuración.
4. Abre **http://nexo.lc:3000**. Escribe `http://` para que el navegador no lo interprete como búsqueda o intente HTTPS.

Si tu router no admite registros DNS locales, puedes usar un servidor DNS propio como Pi-hole o AdGuard Home y configurarlo como DNS de tu red. La dirección IP funciona sin configurar el alias. Editar el archivo `hosts` del PC solamente no hace que el alias funcione en el teléfono.

El puerto `:3000` es necesario con la configuración habitual. Para usar **http://nexo.lc** sin puerto, el servidor tendría que usar el puerto 80 o un proxy local. Puedes iniciar con la variable `PORT=80` si ese puerto está disponible.

## Alcance del acceso

El iniciador habilita la escucha en `0.0.0.0`, por lo que los dispositivos que puedan conectarse al PC pueden usar los chats y las conexiones configuradas. Úsalo en una red de confianza. No abras el puerto en el router hacia Internet. El acceso es HTTP y esta app todavía no tiene inicio de sesión multiusuario.

`npm start` conserva el acceso solo desde el PC por defecto. Para habilitarlo manualmente desde PowerShell:

```powershell
$env:HOST = '0.0.0.0'
npm start
```
