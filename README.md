# Nexo

Chatbot en TypeScript, HTML y CSS, con servidor Node.js y almacenamiento en disco. Conecta modelos locales o APIs compatibles con OpenAI y conserva el mismo historial al cambiar de modelo.

## Ejecutar

En Windows, haz doble clic en `iniciar-chatbot.bat`. El archivo busca Node.js, instala las dependencias si faltan, compila la aplicación y abre el navegador cuando el servidor está listo. Mantén su ventana abierta mientras uses el chatbot; presiona `Ctrl+C` para detenerlo. Si Nexo ya está funcionando, abre esa instancia.

El iniciador también habilita el acceso desde el teléfono en la misma red y muestra las direcciones IP y el alias `nexo.lc:3000`. El alias requiere configurar un registro DNS en el router; consulta [ACCESO-TELEFONO.md](ACCESO-TELEFONO.md). Sin DNS local, usa la dirección IP mostrada.

También puedes iniciarlo manualmente:

Instala Node.js 24 LTS o superior. En esta carpeta:

```powershell
npm install
npm run build
npm start
```

Abre http://localhost:3000. Para desarrollo: `npm run dev` y vuelve a ejecutar `npm run build` cuando cambies el frontend. `npm run check` comprueba los tipos.

## Conectar modelos

En **Modelos y conexiones**, elige una plantilla, ingresa el identificador exacto del modelo y guarda. Puedes registrar varias conexiones, incluso con la misma URL y modelos diferentes. **Probar** consulta `/models`; algunos proveedores pueden admitir chat sin publicar ese listado.

| Servicio | URL base | Requisitos |
| --- | --- | --- |
| Ollama | `http://localhost:11434/v1` | Inicia Ollama y descarga un modelo, por ejemplo `ollama pull llama3.2`. |
| LM Studio | `http://localhost:1234/v1` | Carga un modelo y activa su servidor compatible con OpenAI. Copia el identificador publicado por tu servidor. |
| NVIDIA | `https://integrate.api.nvidia.com/v1` | Copia la clave y el identificador de modelo desde tu cuenta de NVIDIA. |
| Otro endpoint | URL base que incluye `/v1` si corresponde | Debe aceptar `/chat/completions` con mensajes de texto y `stream: false`. |

La aplicación conecta servidores de inferencia; no ejecuta archivos GGUF directamente. Para eso utiliza Ollama, LM Studio u otro servidor local.

## Contexto y persistencia

Cada chat guarda sus instrucciones y todos sus mensajes en `data/database.json`. Cada solicitud incluye las instrucciones como mensaje de sistema y el contexto activo (historial completo o resumen más mensajes recientes si lo compactaste), aunque el modelo elegido haya cambiado. Puedes editar instrucciones con **Contexto** y descargar cada conversación con **Exportar**. Reiniciar Node no borra los chats.

No hay memoria infinita: cada modelo tiene una ventana de contexto finita. Si el historial la supera, el proveedor puede rechazar la solicitud. Nexo no recorta ni resume silenciosamente tu conversación. Si falla una solicitud, conserva el mensaje en el cuadro de escritura y no modifica el historial guardado.

### Reducir los tokens de respuesta

En **Modelos y conexiones → Editar → Optimización de respuesta**, elige **Adaptativa** o **Desactivada**. Nexo no envía `max_tokens` ni `max_completion_tokens` para respuestas del chat. Al iniciar, elimina de las conexiones guardadas los topes de salida introducidos por la versión anterior. El proveedor puede seguir aplicando sus propios valores predeterminados y límites.

La optimización tiene dos partes: un planificador local identifica el formato de la tarea y si se trata de una continuación o de un pedido detallado; después, el modelo recibe instrucciones específicas para expresar los mismos requisitos con menos redundancia. En código prioriza cambios localizados cuando alcanzan, sin omitir un archivo completo si se solicita. En procedimientos conserva pasos y prerrequisitos; en textos finales entrega la pieza directamente. En continuaciones evita desarrollar otra vez lo conocido. Los pedidos de detalle tienen prioridad sobre la brevedad. La clasificación usa reglas de texto y puede equivocarse; solo cambia sugerencias de presentación, nunca filtra el pedido ni el historial.

**Razonamiento adaptativo:** en Qwen3 identificado por nombre o modelo y conectado por loopback (`localhost`/`127.0.0.1`/`::1`), el modo automático usa `chat_template_kwargs.enable_thinking=false` para tareas simples. Las solicitudes de análisis, demostraciones, cálculos, depuración, explicaciones detalladas o mensajes de más de 1500 caracteres conservan el comportamiento del proveedor. Es un cambio del modo de inferencia, no un tope de tokens. Puede afectar la calidad: selecciona **Conservar siempre el del proveedor** si priorizas mantener su razonamiento en cada consulta. Para otros endpoints no se envían parámetros específicos por defecto; puedes elegir el adaptador Qwen3 explícito solo si su plantilla lo admite. El modo desactivado tampoco cambia el razonamiento. Véase la [documentación oficial de Qwen sobre modos de inferencia](https://qwen.readthedocs.io/en/stable/deployment/vllm.html).

Se genera la respuesta en una sola llamada, sin producir primero una versión extensa para volver a resumirla. No se recorta el texto devuelto, no se interrumpe al llegar a una cifra y no se sustituyen los pasos por omisiones. Las instrucciones adicionales también consumen tokens de entrada y están incluidas en la estimación de contexto. La compactación del historial conserva un presupuesto independiente de 768 tokens para generar su resumen; no limita las respuestas al usuario.

La reducción real depende de la consulta y del modelo; no está garantizado pasar de 1800 a 600 tokens sin perder información. Si el proveedor indica que truncó la salida, Nexo lo muestra. Las métricas conservan el consumo informado por el proveedor, incluido el razonamiento que ese proveedor contabilice como salida.

### Medir la mejora con el mismo modelo

Se incluye un comparador A/B opcional. No modifica los chats. Genera una versión normal y otra optimizada con la misma consulta, historial y modelo; alterna el orden entre casos. Guarda ambas respuestas, los tokens de entrada y salida, el tiempo, las reducciones de salida y totales y si el proveedor truncó alguna respuesta. Si faltan datos de tokens, los marca como estimados y no inventa un ahorro total.

```powershell
# Revisar los casos sin llamar a ningún modelo:
npm run benchmark -- --dry-run
# Mostrar los identificadores de conexiones disponibles:
npm run benchmark
# Ejecutar tres comparaciones (seis llamadas al proveedor):
npm run benchmark -- --provider ID
# Usar tus propios casos de prueba:
npm run benchmark -- --provider ID --cases mis-casos.json
# Reusar las respuestas originales de un informe del mismo modelo y casos:
npm run benchmark -- --provider ID --baseline-report data/evaluations/INFORME.json
```

Los casos personalizados son una lista JSON de `{ "name": "Caso", "prompt": "Consulta", "history": [] }`; `history` es opcional y acepta mensajes `user`/`assistant`. Los informes se guardan en `data/evaluations/`, sin claves API. Revisa que las dos respuestas cubran los mismos requisitos, que el código funcione y que no se pierdan condiciones antes de aceptar un ahorro. Menos tokens no demuestra igual calidad; una ejecución es una muestra, no un resultado estadístico. El comparador usa el proveedor configurado y sus llamadas pueden tener costo. No se ejecuta automáticamente.

**Ensayo local del 10 de noviembre de 2026:** con la conexión `qwen3`, el primer enfoque de instrucciones largas produjo respuestas visibles más cortas, pero aumentó los tokens de salida en dos casos. Después de simplificar las instrucciones y aplicar razonamiento adaptativo, las mismas consultas pasaron de 1358 a 145 tokens (explicación), de 2033 a 349 (código) y de 2262 a 394 (continuación). El ahorro total de entrada y salida fue 80,5%, 74,8% y 73,2%, respectivamente. Los valores provienen del proveedor, con las respuestas originales reutilizadas del primer informe y sin topes de salida; son tres muestras no deterministas, no una garantía. El código optimizado pasó compilación TypeScript estricta y una comprobación básica de agrupación, sin demostrar equivalencia general. Las respuestas todavía pueden tener errores o repeticiones. Los informes y notas de revisión se guardan en `data/evaluations/`.

### Métricas y contexto activo

Al enviar un mensaje aparece un indicador animado con el modelo y el tiempo transcurrido. Cada respuesta nueva guarda tokens de salida, duración y velocidad media en t/s. Esta velocidad incluye la espera y el procesamiento de la solicitud; no es la velocidad aislada de decodificación. Se utilizan los tokens informados por `usage.completion_tokens`; si faltan, la cifra aparece como estimada. Las respuestas antiguas sin métricas no muestran una velocidad inventada.

La barra superior muestra el uso **estimado** del contexto activo, incluido el borrador. Cambia de color al superar el 70% y el 90%. En **Modelos y conexiones → Editar → Ventana de contexto** indica la capacidad real configurada para cada modelo (por defecto 32768 tokens). El cálculo aproxima un token por cada tres caracteres más el formato de mensajes, y no reserva espacio para la respuesta; no reemplaza el tokenizador del proveedor.

En **Contexto → Compactar ahora**, el modelo seleccionado resume los mensajes antiguos en fragmentos, integrando cualquier resumen anterior. Se mantienen los dos últimos turnos completos. El historial original sigue visible, guardado y disponible en la exportación; las solicitudes siguientes envían las instrucciones, el resumen y los mensajes recientes. Puedes revisar el resumen en **Ver resumen activo**. Un resumen puede perder detalles. La operación usa la API del modelo seleccionado y puede tener costo según tu proveedor. Si falla, se trunca el resumen o no reduce el contexto, el contexto activo no cambia.

El archivo de datos contiene las claves API en texto plano. No lo compartas ni lo publiques; está excluido de Git. Con `npm start`, el servidor escucha en `127.0.0.1` por defecto; el iniciador `.bat` configura `HOST=0.0.0.0` para compartirlo en la red. No tiene autenticación multiusuario: usa esta función solo en una red de confianza. Cada proveedor remoto recibe las instrucciones y el contexto activo del chat al enviarle un mensaje. Para exponerlo fuera de tu red se necesita autenticación y HTTPS. Puedes cambiar el puerto con `$env:PORT=3001` antes de iniciar.

## Estructura

- `server.ts`: API, conexiones a proveedores y persistencia con escrituras serializadas y reemplazo atómico.
- `public/app.ts`: interfaz y gestión de conversaciones.
- `public/index.html` y `public/style.css`: interfaz adaptable en español.
- `dist/public/app.js`: JavaScript del navegador, generado por TypeScript.

Ejecuta una sola instancia del servidor por carpeta de datos.
