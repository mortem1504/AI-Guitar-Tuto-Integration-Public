# Roadmap — Guitar Learning

Una clase de guitarra que corre entera en el navegador. La cámara ve **la
guitarra** y **las manos**; la app dice qué dedo va en qué traste y si lo
estás haciendo bien. No sintetiza sonido: el sonido lo hace tu guitarra.

El stack es visión (MediaPipe + filtrado One Euro + histéresis) sobre infra
mínima: Vite, TS estricto, i18n, DOM sin `innerHTML`, CSP. Sin audio
sintetizado en ninguna parte.

## Principios

1. **Cero audio sintetizado.** Ni sintes, ni timbres, ni efectos, ni MIDI.
   "Acústica" y "eléctrica" son *tipos de guitarra* (geometría del mástil y
   digitaciones sugeridas), no timbres.
2. **La visión es la maestra.** Todo el feedback sale de lo que se ve:
   posición de la mano sobre el diapasón, dedo por dedo.
3. **Todo local.** Sin backend, sin cuentas, sin telemetría. El modelo de
   manos es la única descarga.
4. **Práctica, no demo.** El objetivo es que alguien que no sabe nada llegue a
   tocar una progresión completa.

## Fases

### F0 — Corte y documentación ✅
Desconectar el remoto viejo, apuntar a `DecoudJuan/Guitar-Learning`, renombrar
la carpeta, y dejar `ROADMAP.md`, `BITACORA.md` y `CLAUDE.md` escritos antes de
tocar código.

### F1 — Demolición ✅
Borrar `src/audio`, `src/midi`, el sintetizador y todo lo que dependía de él.
Reducir `App`, `index.html`, el CSS, los ajustes y los diccionarios al
esqueleto mínimo que compila y muestra la cámara con las manos.

### F2 — Dominio guitarra ✅
`src/guitar/`: afinación estándar, nota en (cuerda, traste), geometría del
diapasón (posición de trastes por `2^(-n/12)`), y una biblioteca de acordes con
digitación real (dedo, cuerda, traste, cejilla) para acústica y eléctrica.

### F3 — Calibración del diapasón ✅
Homografía de 4 puntos: el alumno marca las cuatro esquinas del mástil (cejuela
y traste 12) una vez, y queda guardada. Con eso, cualquier punto de la imagen
se convierte en coordenadas (cuerda, traste) y viceversa.

### F4 — Detección automática del mástil ✅
Visión clásica sobre el frame: escala de grises, Sobel, transformada de Hough.
Las cuerdas son un haz de rectas casi paralelas y los trastes su perpendicular;
de ahí sale el cuadrilátero del diapasón sin que el alumno marque nada. La
calibración manual queda como respaldo y como semilla.

### F5 — Lectura de la mano sobre el diapasón ✅
Las yemas de la mano que pisa se proyectan al espacio del diapasón y se
convierten en un conjunto de posiciones pisadas, con la misma histéresis y el
mismo filtro que usaba el instrumento gestual.

### F6 — Evaluación del acorde ✅
Comparar lo pisado contra la digitación objetivo: qué dedo está bien, cuál
está una cuerda arriba, cuál en el traste equivocado, cuál falta. Salida
estructurada, dedo por dedo, para que la UI pueda ser específica.

### F7 — Motor de lecciones ✅
Currícula progresiva (primeros acordes → progresiones → cambios cronometrados
→ canciones), máquina de estados de la sesión (presentar, sostener, validar,
avanzar), racha, puntaje y progreso persistido.

### F8 — Render y diagramas ✅
Overlay sobre la cámara: el cuadrilátero del diapasón, los puntos objetivo,
los dedos detectados en verde/rojo. Diagrama de acorde clásico al lado.

### F9 — Interfaz ✅
Panel de ajustes (tipo de guitarra, zurdo/diestro, tolerancia, idioma),
selector de lección, importación de cifrados para practicar canciones, y la
guía de calibración. Traducciones completas es/en.

### F14 — El detector deja de mentir, y el mástil recordado se sigue ✅ (a medias)
El seguimiento no funcionaba nunca después de recargar la página: la
calibración leída de `localStorage` llega antes que la cámara y el tracker se
quedaba sin anclas. El detector automático aprendió a rechazar cualquier cosa
rayada que no tenga trastes, con dos arneses sin cámara (`fret-check`,
`scene.mjs` + `neck-check`) y, por fin, con siete fotos reales, que son las que
dijeron dónde falla de verdad. Sigue apagado: ya no inventa, y en una foto real
no llega ni a mirar la guitarra.

### F13 — Registro por homografía ✅
El mástil se sigue solo cuando la guitarra se mueve: una grilla de anclas sobre
el diapasón, cada una con su parche de imagen, rastreadas por correlación
normalizada contra el cuadro de la calibración, y la matriz re-estimada por
consenso. Verificado con `npm run track-check`.

### F12 — Contra una guitarra real ✅ (a medias)
La calibración manual deja de depender del orden de los clics y el traste
marcado se corrige contra la grilla. El detector automático se volvió medible
(`npm run neck-check -- foto.png`) y mejoró mucho por dentro, pero sigue
eligiendo las rayas de una cama antes que un mástil, así que arranca apagado.

### F11 — Afinador ✅
Lo único que la cámara no puede hacer. Micrófono abierto solo mientras el panel
está abierto, detección de tono por MPM, y las seis cuerdas como una lista que
se va tildando. Rompe la promesa de "no hay micrófono" y por eso viene con
SECURITY.md reescrito en el mismo commit.

### F10 — Deploy ✅
`vercel.json` con la CSP ajustada, README reescrito, `npm run build` limpio.

---

## Después del roadmap

Lo que queda anotado como próximo, en orden de valor:

- **Tests.** La homografía, la geometría de trastes, el juez y el viewport son
  funciones puras esperando un runner. El detector de tono ya se verificó contra
  señales sintéticas a mano; ese chequeo merece dejar de ser un script temporal.
- **Que el detector automático funcione.** F14 usó la primera de las dos pistas
  anotadas —la *progresión logarítmica* de los trastes, que ninguna manta
  tiene— y agregó dos anclas físicas: la cejuela es el último alambre, y la
  escala es dieciséis veces el ancho entre las cuerdas exteriores (esto último
  es lo que rompe la degeneración de corrimiento y quedó verificado contra una
  foto real). Con eso dejó de mentir. Pero siete cuadros reales dan siete
  `null`, y ahora se sabe por qué: **falla en la primera etapa**, los picos de
  Hough de la habitación se comen los noventa lugares y las líneas de la
  guitarra no entran nunca. Seguir afinando el ajuste no puede arreglar eso.
  Lo que hay que cambiar es cómo se propone la región: buscar el diapasón como
  *región* (oscuro, liso, alargado, con una grilla brillante encima) o barrer
  direcciones y bandas directamente, porque el perfil de bordes sí encuentra
  trastes reales cuando se le da la región correcta. La otra pista sigue sin
  usar: las seis cuerdas convergen a un punto de fuga común, que daría el
  trapecio verdadero en vez del paralelogramo de hoy.
- **Cambios cronometrados.** Un metrónomo visual y una lección que exige llegar
  al acorde dentro del tiempo, que es como se practica de verdad.
- **Ritmo de la mano derecha.** La otra mano está en el cuadro y no se mira.
- **Más formas.** La biblioteca cubre lo que un principiante necesita; los
  acordes que un cifrado pide y no están se reportan pero no se enseñan.
