# Bitácora

Registro de decisiones y de lo que se hizo, en orden. Lo que no está acá se
lee del código; lo que está acá es el *por qué*.

---

## 2026-09-08 — F0: el punto de partida

**Qué se hizo.** Se dejó el repo en `DecoudJuan/Guitar-Learning`, todo
consolidado en `main`, y se escribieron `ROADMAP.md`, `BITACORA.md` y
`CLAUDE.md` antes de tocar código.

**Decisión: el stack de visión antes que la interfaz.** Lo caro de escribir es
lo que está debajo: el pipeline de MediaPipe con filtro One Euro, la histéresis
de dedos medida sobre landmarks *world* (que es lo que hace que sobreviva a la
rotación de la mano), la gracia por mano ante pérdidas de detección, el
andamiaje de i18n con claves tipadas y la disciplina de DOM sin `innerHTML`.
Todo eso es la base de mirar una mano sobre un diapasón.

**Decisión: cero audio sintetizado.** Si la app enseña guitarra, el sonido lo
produce la guitarra del alumno; un sintetizador competiría con el instrumento
real. "Acústica" y "eléctrica" existen como *tipo de guitarra*, no como timbre:
cambian la geometría del mástil (ancho de cejuela, cantidad de trastes
accesibles) y las digitaciones que se sugieren, no el sonido.

---

## 2026-09-08 — F1: demolición

**Qué se hizo.** Se borraron `src/audio/` (sinte, voces, timbres, batería,
efectos, grabadores WAV y video), `src/midi/`, `src/music/chords.ts` y todo lo
que en `App` traducía gestos a frecuencias. `src/music/theory.ts` se conservó
recortado: los nombres de las doce notas y la aritmética de semitonos siguen
haciendo falta para nombrar lo que se pisa.

**Decisión: se conserva `src/song/parse.ts` intacto.** Parsear un cifrado
pegado ("Am F C G" sobre la letra) es exactamente lo que hace falta para la
fase de canciones, y ese parser ya aprendió a la mala que las letras parecen
acordes. Reusarlo es gratis.

**Decisión: se conserva `src/gesture/Steady.ts` y la histéresis.** El problema
que resolvían —que un valor discreto no parpadee entre frames— es idéntico
cuando lo discreto es "el dedo 3 está en el traste 2" en vez de "el acorde es
un IV". Sin esto, el feedback titila y es inusable.

---

## 2026-09-08 — F2: dominio de la guitarra

**Decisión: los trastes se calculan, no se tabulan.** La posición del traste
`n` sobre la escala es `1 - 2^(-n/12)`. Una tabla sería equivalente pero
mentiría sobre el origen del número; la fórmula deja claro que un diapasón es
una escala logarítmica y permite cualquier largo de escala (Fender 25.5",
Gibson 24.75") con un solo parámetro.

**Decisión: la biblioteca de acordes guarda digitación, no solo notas.** Un
acorde de guitarra no es un conjunto de notas: es una posición concreta de
dedos. Enseñar requiere decir "el dedo anular va en la tercera cuerda, segundo
traste", así que cada forma guarda `{ dedo, cuerda, traste }` más las cuerdas
al aire y las silenciadas.

---

## 2026-09-08 — F3/F4: el diapasón

**Decisión: homografía de 4 puntos como base, detección automática encima.**
Un diapasón visto en perspectiva es un cuadrilátero; con las cuatro esquinas
(cejuela y traste 12) alcanza para una homografía que convierte cualquier píxel
en coordenadas (cuerda, traste). La calibración manual va primero porque es
determinista y se puede depurar; la detección automática por Hough se apoya en
la misma representación, así que puede fallar sin romper nada.

**Decisión: visión clásica, no otro modelo.** Meter un segundo modelo (YOLO,
segmentación) costaría megabytes de descarga, tiempo de GPU compitiendo con el
tracker de manos, y una dependencia más. Un diapasón es el caso ideal de la
transformada de Hough: seis rectas casi paralelas y equiespaciadas, cruzadas
por trastes perpendiculares y brillantes. Se implementa a mano sobre el
`ImageData` del canvas.

---

## 2026-09-08 — F5/F6: leer y evaluar la mano

**Decisión: se evalúa por dedo, no por acorde.** Decir "mal" no enseña. El
evaluador compara cada dedo objetivo con el más cercano de los detectados y
devuelve un diagnóstico: correcto, cuerda equivocada, traste equivocado, o
ausente. La UI recién entonces decide cómo decirlo.

**Decisión: tolerancia configurable.** Una yema no cae en el centro geométrico
del casillero, y la homografía tiene error. La tolerancia (en fracciones de
casillero) es un ajuste del alumno: estricta para pulir, generosa para empezar.

---

## 2026-09-08 — F7: lecciones

**Decisión: sostener, no tocar de paso.** Un acorde cuenta como logrado
después de mantenerlo correcto durante un tiempo continuo (por defecto ~1s).
Eso separa el acierto real del dedo que pasó por ahí, y es además lo que hay
que entrenar: la mano tiene que *quedarse*.

**Decisión: el progreso vive en localStorage y se trata como hostil.** Igual
que los ajustes: se valida y se recorta al cargar. Un progreso corrupto vuelve
a cero en vez de romper la app.

---

## 2026-09-08 — F8/F9: dibujar y la interfaz

**Decisión: la flecha.** Un punto rojo dice que el dedo está mal; una flecha
desde donde está hasta donde va dice la corrección entera, de un vistazo y sin
idioma. Es lo más útil que hay en pantalla y por eso `chordLayer` existe como
capa separada del juez: el juez decide qué es verdad, esa capa decide qué vale
la pena mostrar, y casi todo lo cierto sobre un acorde mal puesto es ruido.

**Decisión: el diagrama clásico se mantiene.** Es la notación que el alumno va a
encontrar en cualquier cancionero. Una clase que enseña su propia notación
privada lo deja sin poder leer nada más. Los mismos tres colores en la cámara y
en el diagrama unen las dos vistas sin explicación.

**Decisión: se elimina el ajuste de tempo.** Quedó heredado de la idea del
metrónomo visual para los cambios cronometrados, pero nada lo usa. Una perilla
que no hace nada es una mentira sobre lo que el programa puede hacer; vuelve
cuando vuelva la función.

**Decisión: la práctica libre llega a toda la biblioteca desde el primer
minuto.** El bloqueo de lecciones ordena un curso para quien no sabe qué
practicar después; nunca quiso negarle un Do a alguien que quiere probarlo.

---

## 2026-09-08 — F10: deploy

**Qué se hizo.** CSP ajustada (sin micrófono, sin MIDI: se apagan en la
`Permissions-Policy` en vez de quedar simplemente sin usar), `base` de Vite de
vuelta a `/` para Vercel, y README, SECURITY y CLAUDE reescritos alrededor de lo
que la app es ahora.

**Decisión: SECURITY.md se reescribe entero en vez de recortarse.** El documento
original prometía cosas sobre grabaciones, micrófono y MIDI que ya no existen.
Un documento de seguridad que describe un programa anterior es peor que no
tenerlo: se lee como una promesa verificada cuando ya no verifica nada.

**Pendiente honesto.** No hay tests automáticos — la única red es `tsc` en modo
estricto. La lógica difícil (homografía, geometría, juez, viewport) está escrita
como funciones puras justamente para que se pueda probar sin cámara el día que
se agregue un runner; no se agregó ahora para no meter una dependencia de
desarrollo en la misma pasada en que se sacaron todas.

---

## 2026-09-08 — F11: el afinador

**Qué se hizo.** Se agregó `src/tuner/`: micrófono, detección de tono y mapeo a
la cuerda al aire más cercana, con un panel de seis filas que se van tildando.

**Decisión: vuelve el micrófono, y se dice.** Es la única excepción a "todo se
resuelve mirando", y no es negociable: una cuerda floja y una tensa son la misma
foto. La CSP y la `Permissions-Policy` se abren para `microphone=(self)` y
SECURITY.md pasa a describirlo en detalle. Lo que se mantiene entero es el
contrato: se abre al abrir el afinador, se cierra —pistas detenidas, contexto
cerrado— al cerrarlo o al ocultarse la pestaña, y la señal llega a un
`AnalyserNode` y a ningún lado más. Nunca a los parlantes, que es además lo que
hace imposible el acople con una guitarra frente a la notebook.

**Decisión: MPM y no autocorrelación pelada.** La autocorrelación simple tiene
picos que se achican con el lag, así que lee el mi grave como su propia octava:
el alumno ve que su cuerda más gruesa está una octava alta y un afinador que no
se decide. La normalización del NSDF elimina ese sesgo. Por la misma razón se
elige el *primer* pico que llegue al 90% del mejor y no el mejor: una cuerda
pulsada es rica en armónicos y el pico más alto suele ser la octava.

**Decisión: los umbrales salen de medir, no de estimar.** Contra pulsaciones
sintéticas con ruido blanco encima, la claridad cae con la señal: limpia da
0.99+, con ruido moderado 0.97 y el error sigue debajo de dos cents, y con
ruido fuerte da 0.88 mientras la respuesta ya se corrió veintitrés cents.
`MIN_CLARITY` quedó en 0.93, arriba de ese punto. Un afinador que calla en una
sala ruidosa es mejor que uno que miente con seguridad.

**Decisión: se busca la cuerda al aire, no la nota cromática.** "Fa#, 40 cents
bajo" sirve a quien ya sabe. El principiante necesita "esa es la cuarta, tensala".
El límite para reclamar una cuerda bajó de 250 a 150 cents: con 250, como la
distancia máxima entre cuerdas contiguas es de cinco semitonos, *cualquier* tono
reclamaba alguna cuerda — incluida una nota pisada, que aparecía como una cuerda
al aire horriblemente desafinada y mandaba al alumno a mover una clavija que
estaba bien.

**Decisión: la cuerda tiene que *sostenerse* afinada para tildarse.** Misma
razón que el acorde: una clavija que pasa por la tensión correcta camino a otro
lado no es una cuerda afinada.

---

## 2026-09-09 — F12: la primera prueba con una guitarra de verdad

Dos fallas reportadas desde el uso real. Una era mía y grave; la otra sigue
abierta y ahora está medida.

### Los dedos de un acorde aparecían separados por tres trastes

**Causa.** La calibración confiaba en que el alumno clickeara las cuatro
esquinas exactamente en el orden pedido. La intro decía "hacé clic en las
cuatro esquinas del diapasón" —que invita a dar la vuelta al rectángulo— y los
pasos pedían cejuela-grave, cejuela-agudo, traste12-agudo, traste12-grave. Son
dos instrucciones distintas. Clickeando en el orden que invita la intro, la
homografía mapea el eje "a lo ancho del mástil" sobre el eje "a lo largo": la
grilla se dibuja igual, la app sigue andando, y cada acorde sale con los dedos
desparramados por medio mástil. **Nada avisa que algo está mal**, que es lo peor
del asunto.

**Decisión: no depender del orden.** `orderCorners` deduce el orden de la forma
de lo clickeado, y un mástil se delata solo: es mucho más largo que ancho, así
que los dos lados *cortos* del cuadrilátero son las puntas; y se abre hacia el
cuerpo, así que la punta más angosta es la cejuela. Lo único irrecuperable de
la forma es cuál lado es el mi grave —eso es para qué lado está puesta la
guitarra, no qué forma tiene— y para eso está el botón de dar vuelta. Verificado
contra los cuatro órdenes de clic posibles.

**Decisión: el traste marcado es ajustable.** Un diapasón tiene esquinas en su
*extremo*, no en el traste 12, así que pedir "las esquinas del diapasón"
consigue exactamente eso: un mástil estirado al doble. Ahora hay un stepper que
corrige el número contra la grilla dibujada sobre el mástil real. Se verifica
mirando, no confiando.

### El detector automático no encuentra el mástil

**Qué se hizo.** Se reescribió entero y —más importante— se volvió medible: el
análisis se separó del canvas (`detectInGrey`) y `scripts/neck-check.mjs` lo
corre contra una foto fija, con un decodificador PNG propio para no sumar
dependencias. Todas las constantes que hoy tienen un número en su comentario
salieron de ahí.

Lo que se aprendió corriendo, en orden:

- **El PCA sobre todos los bordes del cuadro era una fantasía.** El comentario
  original decía que las cuerdas dominan cualquier foto con una guitarra. No es
  cierto: una cama, un almohadón y una remera con letras las superan cómodas.
- **`PEAK_THRESHOLD` a 0.25 del pico máximo dejaba 3 líneas en toda la imagen.**
  Una cuerda es fina y corta; el borde de una cama la supera muchas veces. A
  0.05 aparecen sesenta líneas y seis son las cuerdas.
- **A 320px de ancho las cuerdas caen a 3px y el ángulo sale 10° torcido.** A
  480px, el mismo cuadro da el ángulo del mástil con un grado de error.
- **Con umbral global, dentro del mástil quedaban 121 píxeles de borde y cero
  trastes.** El diapasón es lo más oscuro de una habitación iluminada. Con
  umbral calculado *dentro* de la banda de las cuerdas, 856.
- **Los trastes que sí aparecen están todos juntos cerca de la cejuela**, donde
  pega la luz. Pedirles que definan el largo del mástil daba un "mástil" de 24
  píxeles, así que el largo pasó a salir de hasta dónde llegan las cuerdas.

**Y sin embargo sigue fallando.** Sobre la foto real, el haz que gana es una
franja de la cama al fondo del cuadro, casi al mismo ángulo que el mástil. Se
agregó el discriminador correcto en principio —solo una guitarra tiene rayas en
las dos direcciones, así que los trastes eligen entre los haces candidatos— y
la cama igual gana, con confianza 0.90.

**Decisión: `autoDetect` arranca apagado.** Es una medición, no prudencia. Un
detector que se equivoca con seguridad es peor que uno que no está: marcar
cuatro esquinas tarda cinco segundos y siempre funciona, mientras que un mástil
confiadamente mal le cuesta al alumno la confianza en todo lo que la app diga
después. El botón queda para quien quiera probar, y el harness queda para que el
próximo intento se pueda medir en vez de suponer.

---

## 2026-09-09 — F13: la homografía como registro, no solo como mapeo

**Aclaración que vale la pena dejar escrita.** La homografía ya era el corazón
del proyecto desde F3: `Fretboard` la usa para convertir el diapasón en la
imagen y viceversa. Lo que faltaba era el *otro* uso, el de las panorámicas:
**registro entre dos vistas de la misma escena plana**. Eso es lo que se agregó.

**Decisión: seguir puntos conocidos en vez de volver a detectar.** La
calibración es una foto de un momento, y una guitarra en la falda no se queda
en ese momento: se corre al acomodarse, se inclina al buscar una cejilla, y
para el cuarto acorde la grilla está a centímetros de la madera. La ventaja
enorme del registro sobre la detección es que ya no hay que *encontrar* el
mástil — se sabe dónde estaba y dónde debería estar cada punto de él. Es una
pregunta mucho más chica, y a diferencia del detector no necesita distinguir un
diapasón de un acolchado.

**Decisión: parches con correlación normalizada, plantilla siempre la
original.** Dos detalles hacen que no derive y no mienta. NCC en vez de
diferencia cruda, porque una nube que pasa o una mano que sombrea el mástil
cambian el brillo de todos los píxeles a la vez y la correlación normalizada
compara *forma*. Y comparar siempre contra el cuadro en que el alumno calibró,
nunca contra el cuadro anterior: encadenar cuadros acumula una fracción de
píxel por vez y en un minuto la grilla se caminó de la guitarra. Contra la
referencia original no puede derivar — solo puede perder el punto, que es una
falla que se anuncia sola.

**Decisión: consenso antes que mínimos cuadrados, y esto salió de medirlo.** La
primera versión ajustaba sobre todos los puntos y después descartaba los que
no coincidían. El `track-check` mostró que eso no funciona y cómo falla: tres
anclas malas de dieciocho corrieron el ajuste **45 píxeles**, y desde ahí los
puntos buenos también parecían malos — se quedó con dos anclas y se rindió.
Mínimos cuadrados no tiene defensa contra outliers porque está ocupado
acomodándolos. Con consenso a lo RANSAC —cuatro anclas al azar, medir cuántas
coinciden, quedarse con el acuerdo más grande y recién ahí ajustar— el mismo
caso baja a **2,6 píxeles**.

El comentario de encabezado del archivo describía el algoritmo viejo durante
media hora. Quedó corregido: un comentario que describe un algoritmo que ya no
está es peor que ninguno.

**Decisión: un null del tracker significa "quedate con lo que tenés".** No es un
error. Una guitarra tapada por una mano un segundo no puede borrar la lección.

## 2026-09-09 — F14: mientras se marca el mástil, la pantalla es de la marca

Probando con la guitarra de verdad apareció algo obvio recién cuando pasa: al
volver a calibrar, la pantalla sigue siendo la de la clase. Los números de
traste, los círculos del acorde y la flecha del dedo quedan justo sobre las
cuatro esquinas que hay que clickear, y el cartel de la calibración aterriza
encima del cartel del coach porque los dos viven abajo y al centro.

**Decisión: durante la calibración se dibuja la grilla y los puntos, nada más.**
Ni números de traste, ni objetivos del acorde, ni esqueleto de la mano. No es
un problema de estética: un número de traste tiene fondo oscuro y radio de diez
puntos, así que tapa literalmente el píxel que el alumno quiere marcar. La
grilla sí se sigue dibujando, porque la pregunta del selector de traste
("¿caen los trastes dibujados sobre los reales?") se contesta mirándola.

**Decisión: el coach se calla mientras se marca.** No es que estorbe visualmente
—es que la lección no es lo que está pasando— y además los dos carteles se
pisaban.

**Decisión: el cartel se mueve, no se adivina.** Ninguna esquina es segura: la
guitarra puede apuntar para cualquier lado y estar a cualquier altura del
cuadro, y en la prueba el cartel tapó el punto 3. En vez de elegir un lugar
"bueno" el cartel es angosto, arranca abajo a la izquierda y hay un botón que
lo lleva a la siguiente esquina. Un botón y cuatro posiciones antes que
arrastrar, que en un teléfono sería otra cosa que puede salir mal.

## 2026-09-09 — F14 (2): el mástil remembrado no se seguía, y el detector mentía

Dos reportes de la misma sesión con la guitarra real: "cuando le doy a buscar el
mástil automáticamente no cambia nada, se mantiene estático, ni lo sigue cuando
se mueve", y una captura donde *Buscalo vos* dibujó un cuadrilátero cruzando la
habitación y anunció **mástil encontrado**.

**El bug del seguimiento: la calibración recordada nunca tomaba referencia.** El
`NeckTracker` toma sus anclas en `acceptCorners`, es decir en el momento en que
el alumno marca. Pero `restoreCalibration()` corre en el constructor, antes de
que exista cámara, así que una calibración leída de `localStorage` —o sea
cualquier recarga de la página, que es el caso normal— dejaba el tracker sin una
sola ancla, `ready` en false, y `track()` devolviendo null para siempre. La
grilla quedaba clavada donde se la había dejado la sesión anterior. F13 estaba
verificada con `track-check` y la matemática estaba bien; lo que faltaba era el
cable. Ahora `followNeck` toma la referencia en el primer cuadro vivo en que hay
mástil conocido, y de paso recupera las anclas si alguna vez se tiran.

**El detector: seis rectas paralelas y equiespaciadas no eran nunca la
evidencia.** Es el patrón de una manta, de un radiador, de una persiana y de las
costillas de una almohada. La pista que el ROADMAP tenía anotada y sin usar es
la que separa: los trastes **no** están equiespaciados, se juntan según
`2^(-n/12)`, y eso no lo hace nada en una habitación.

Lo que se aprendió midiendo (`npm run fret-check`, `node scripts/scene.mjs` +
`npm run neck-check`), en orden, porque cada paso corrigió al anterior:

- **Tolerar el modelo de trastes no alcanza.** Sobre los primeros cinco trastes
  los huecos se acortan apenas un 6% cada uno, así que las rayas de una manta
  entran en cualquier tolerancia que sobreviva a un píxel de ruido: *todos* los
  casos rayados pasaban. Lo que una manta no puede hacer es ajustar la curva de
  trastes **mejor que una recta**. Se ajustan los dos modelos y la guitarra
  tiene que ganar por la mitad (`EVEN_MARGIN`).
- **La progresión de trastes es invariante al corrimiento de traste.**
  Renumerar los trastes `n+k` y multiplicar la escala por `2^(k/12)` da
  exactamente las mismas posiciones: los trastes 1 a 7 ajustan como 4 a 10 con
  residuo `1e-13`. Se escribió un ajuste con la cejuela libre y **no puede
  existir**; el número de traste sale sólo si se ancla la cejuela donde las
  cuerdas terminan. Quedó como chequeo para que nadie lo intente de nuevo.
- **En un mástil los trastes le ganan la elección de haz a las cuerdas.** Hay
  diez y son casi equiespaciados, contra seis cuerdas: el haz de cuerdas no
  entraba ni en los cinco candidatos, y el cuadrilátero salía girado noventa
  grados. Cada haz se lee ahora dos veces, como cuerdas y como trastes, y el
  ajuste de trastes elige.
- **Hough sirve para direcciones y no para medir.** Un pico es un bin: huecos
  de 7 px salían 22.6, 21.1, 20.7, 16.5, 20.6 — ni progresión ni monótonos, y
  el detector encontraba el mástil a un ancho de trabajo y lo perdía en el
  siguiente, que es la firma de un estimador ruidoso y no de una idea
  equivocada. Las dos direcciones se miden ahora sobre un **perfil de magnitud
  de borde de un píxel**, con pico sub-pixel por parábola: cada traste aporta
  cientos de píxeles a su propia posición.
- **Las proporciones del instrumento son un filtro gratis.** La escala es más
  de doce veces el ancho del mástil (cejuela 43-52 mm, escala 630-650 mm), y un
  diapasón se ensancha un tercio pero nunca es una cuña. Eso descartó el último
  falso positivo, que era una guitarra real leída de costado: sus seis cuerdas
  convergen por perspectiva, y un haz que converge se junta igual que los
  trastes.

**Dónde quedó, dicho sin adornos.** Rechaza la manta, encuentra la dirección y
la cejuela de un mástil dibujado, y estira el extremo lejano más allá de donde
el mástil termina (lee nueve trastes como quince). O sea: dejó de mentir, todavía
no acierta. `autoDetect` sigue **apagado** y la calibración a mano sigue siendo
la verdad. Lo que falta no es otra constante: hacen falta fotos reales, varias,
porque las escenas sintéticas ya están al límite de lo que pueden enseñar y
seguir afinando contra ellas es sobreajustar un dibujo.

## 2026-09-09 — F14 (3): siete fotos reales, y lo que dijeron

Siete cuadros de la webcam, la guitarra sobre la falda, en la habitación de
siempre. Es la evidencia que faltaba y cambió el diagnóstico completo. Sirvieron
para arreglar tres cosas y para descubrir dónde está el problema de verdad.

**La cejuela no está donde terminan las cuerdas.** El ajuste anclaba la cejuela
en el extremo del recorrido de las cuerdas, que es cierto en un dibujo y falso
en una guitarra: las cuerdas van del puente a los clavijeros, así que sus dos
extremos están en otra parte y la cejuela queda a un cuarto del camino. Lo que
la cejuela *es*, en una foto, es **el último alambre**: los trastes terminan ahí
y el clavijero no tiene ninguno. Ahora se prueba cada extremo del grupo de
alambres como cejuela, y ser el extremo es lo que dice que no hay nada detrás.

**Un traste cruza el mástil entero; un pliegue de remera no.** El perfil de
bordes contaba cualquier cosa que cayera en la banda, y en una foto real la
banda cruza toda la imagen: la remera, la almohada, el borde de la cama. Cuarenta
alambres donde la guitarra tiene doce, y un "mástil" del ancho del cuadro. El
perfil se mide ahora en cuatro **carriles** a lo ancho y cada bin se queda con
el *mínimo* de los cuatro: la pregunta pasa a ser "esta línea llega de lado a
lado", y eso sólo lo contesta un traste. (Con un bug propio en el camino: para
el haz leído como trastes los carriles estaban partidos a lo *largo*, o sea le
pedían a cada traste aparecer en todo el largo del mástil, y el perfil devolvía
cero alambres en todas las fotos.)

**La escala es dieciséis veces el ancho entre las cuerdas exteriores, y eso
rompe la degeneración de corrimiento.** Un ajuste de trastes encaja igual de
bien corrido k trastes con la escala multiplicada por `2^(k/12)`, así que los
alambres solos nunca dicen si el primero es el traste 1 o el 4 — y en las fotos
el ajuste caía tres trastes corrido, sobre el diapasón correcto, con el ángulo
correcto y el ancho correcto. El ancho es lo que dice cuál corrimiento es el
real: 35 mm entre las cuerdas exteriores en la cejuela de una acústica, 43 en
una clásica, contra escalas de 630-650 mm. **Verificado en la foto 40**: un
ancho medido de 130 px predice una escala de ~2080 px, y la medida era ~2040.
De paso mostró que las escenas dibujadas estaban desproporcionadas (mástil a un
veinticuatroavo de su escala, en vez de un dieciseisavo) — un error del test y
no de lo testeado, ya corregido en `scripts/scene.mjs`.

**Y el veredicto, que es lo importante: el detector falla en la primera etapa.**
Con todo lo anterior, las siete fotos dan **null**, y el motivo es medible: en
ninguna de las siete el buscador de haces (picos de Hough + series
equiespaciadas) devuelve un haz que sean las cuerdas o los trastes de la
guitarra. Las bandas candidatas medían 400 a 575 píxeles de trabajo de ancho,
donde el mástil mide unos 32. Los picos de Hough de una habitación —el borde de
la cama, el respaldo, la almohada, los pliegues de la remera— se comen los
noventa lugares disponibles y las líneas de la guitarra no entran. Todo lo que
viene después estaba trabajando sobre la habitación, y las dos detecciones que
por un rato parecieron buenas eran suerte: caían sobre el diapasón porque el
perfil de alambres encuentra los trastes reales *incluso dentro de una banda
equivocada*.

Esa última frase es la pista para el próximo intento, y es concreta: **la
búsqueda tiene que manejarla el perfil, no los haces de Hough.** El perfil sabe
encontrar trastes; lo que no hay es una manera de proponerle la región correcta.
Buscar primero el diapasón como *región* (lo oscuro, liso y alargado con una
grilla brillante encima) o barrer direcciones y bandas directamente son las dos
formas de darle esa región.

`autoDetect` sigue apagado, y con más razón que antes: ahora se sabe que en una
foto real no llega ni a mirar la guitarra.

---

## 2026-11-02 — AI Guitar Coach, Phase 0: the fork

From here on the log is in English, because the capstone team works in English.

**What was done.** The repository was cloned with its history intact and renamed
AI Guitar Coach in the page title, the header, the start screen (both locales),
`package.json` and the README. The MIT licence stays as it was, and the README
credits the original: "Based on Guitar-Learning by DecoudJuan, MIT". The
`origin` remote was renamed `upstream` so that nothing gets pushed by accident
to a repository that is not ours.

**Decision: the app will listen while you play.** This reverses the base
project's rule that the microphone belongs to the tuner alone. The capstone's
goal is a verdict on single notes within 200 ms, which only the sound can give:
the camera cannot tell a fretted note from a ringing one, or a sharp one from an
in-tune one. The terms that made the tuner acceptable carry over unchanged. The
microphone is processed in the browser, never recorded or uploaded, never routed
to the speakers, and released when nothing needs it. CLAUDE.md and SECURITY.md
will be rewritten in the same commit that opens the microphone for practice
(Phase 1), as they were for F11.

**Decision: no YOLO.** The team's original plan trained a detector for the
fretboard. The four-click homography plus `NeckTracker` already does that job
exactly, with no dataset, no training and no extra model download. The README
explains it for the team.

---

## 2026-11-02 — Phase 1: the app listens while you play

**What was done.** `src/audio/`: the microphone with speech processing off, an
AudioWorklet that runs a pure `NoteDetector` (SuperFlux onsets, then MPM or YIN
pitch on a window starting 20 ms after the onset, extended from 2048 to 4096
samples below 120 Hz), a cleaned event stream, and a listen panel that names
the note with its octave. `?debug` shows Hz, cents, confidence and latency;
`?debug&source=synth` feeds a known signal instead of the microphone. The start
card gained "Just listen (no camera)". `npm run note-check` measures all of it
without a guitar.

**Decision: the detector is pure and the worklet is a wrapper.** Same reason as
`judge.ts`: what cannot be run without hardware cannot be measured, and what is
not measured drifts. The lab and the browser will be scored on the same files.

**Measured, and what it changed** (all on synthesised plucks, `note-check`):

- *Pitch cost.* The tuner's direct correlation loop took 2.5-2.9 ms for a 4096
  window, more than the 2.67 ms render quantum. FFT correlation: 0.6 ms (MPM),
  0.8 ms (YIN), whatever the window. Pitch stays inline in the worklet.
- *Onset spikes in decaying notes.* Plain spectral flux spiked to 33 inside a
  ringing note against onsets as low as 45: neighbouring partials beat inside
  one FFT bin. SuperFlux (compare with the neighbour maximum two hops back)
  separated them.
- *The 512-sample onset frame was wrong, and the first harness hid it.* The
  browser test signal read E2 as A2. The low E's period (12 ms) is longer than
  a 512-sample frame (11 ms), a plucked string is pulse-like, so frame energy
  swung every period and fired ~30 false onsets per 19 real ones, each one
  replacing the note waiting for its window. `note-check` had passed because its
  synthesiser gave partials random phases, which smooths the waveform; it now
  uses the coherent phases of a string released from a triangle, and the
  browser's signal is a regression test. At 1024 samples: no false onsets and
  no added lag.
- *Thresholds.* With 1024-sample frames: decay spikes ≤ 18, onsets from
  silence ≥ 57, a same-loudness re-pluck 150 ms later 28. `fluxMin` = 22 sits
  in that gap with ~4 to spare each side: thin, and first on Phase 2's list.
- *Accuracy.* MPM and YIN both read 156/156 notes (strings 1-6, frets 0-12, two
  takes) in clean, noisy (20 dB SNR) and laptop-like (250 Hz high-pass) rooms,
  plus E6 at the 24th fret and 44.1 kHz input. Synthesis cannot choose between
  them; MPM stays as the cheaper one until real recordings do. A synthesiser
  also does not make octave errors the way a laptop microphone does — that
  claim waits for Phase 2.
- *Latency.* Onset to pitch: p50 61-67 ms, p95 104-107 ms (the long window for
  the thick E's lowest notes is the p95). In Chrome via the test signal, onset
  to the main thread measured p50 64, p95 107 ms. Onset to screen could not be
  measured in the tool's browser pane, which ran animation frames at 1 per
  second; the readout now shows both halves so it can be measured on a laptop.

**Known limits, written down so they are not rediscovered.** Notes left ringing
on other strings make the window a chord: the onset is heard and reported as
"didn't catch that". A newer onset replaces a note still waiting for its
window, so very fast playing loses notes. The input hardware's own delay is not
in the latency figure; `AudioContext.baseLatency` (~5 ms here) is shown beside it.

## 2026-11-02 — Phase 2: the lab measures the browser's detector

**What was done.** The lab (`../lab`) gained a guided recorder
(`record_dataset.py`: every string, frets 0-12, two takes per microphone, into
`data/notes/` with `labels.csv`), an evaluator (`evaluate.py`), an exporter
(`export_params.py`) and a pytest suite. The web app gained `npm run
audio-check`, a spectral octave check (`dsp/octave.ts`, off by default), the
exercise-aware prior (`prior.ts`, for Phase 3's exercises), and a second
parameter layer: `params.lab.ts`, generated from an evaluation run.

**Decision: the lab measures a line-for-line Python mirror, and the browser
checks it.** Running TypeScript from Python, or Python's detector in the
browser, would each have made one side a guess about the other. Instead
`lab/src/audio/note_detector.py` copies `dsp/` and reads its parameters from
`params.ts` itself, and `audio-check` runs the real TS class over the same WAVs.
On the 468 synthetic clips both give the same answer on every clip, for every
variant (11 × 468, 0 disagreements). The brief's limit is 2 points.

**Decision: the dataset never tells the player what was heard.** The recorder
checks only the recording (clipping, too quiet, plucked before recording
started). If it showed the detected note, takes would be redone until the
detector agreed, and the dataset would measure the detector against itself.

**Decision: export only measured, browser-runnable variants.** `export_params.py`
refuses synthetic data, lab-only variants (the 30-150 ms median, which needs a
150 ms wait) and runs made against different parameters than today's. Each
exported value carries its run id and numbers in a comment.

**Measured, and what it changed** (synthetic set, `lab/results/20261102-192956-synthetic-*`):

- *The octave check works on the octave trap and costs nothing elsewhere.*
  The "trap" microphone (laptop high-pass, odd partials ×0.15) fools MPM on
  155 of 156 clips; with the check, 0. Clean and noisy rooms: 100% either way.
  The trap is built to fail, so this proves the mechanism, not the size of the
  problem on a real laptop.
- *The octave check had a resolution bug, found by the median variant.* Read
  30-150 ms after the onset, 59 clips at 117-165 Hz came out a fifth low: in a
  2048 window, a 2f/3 candidate's partials sit inside the main lobe of f's own,
  and once the upper partials decay that leakage passes the ratio test. Partials
  closer than the window can resolve are now skipped: 3 left, and the 20 ms
  window (what the browser uses) was never affected.
- *A later window or a 1000 Hz ceiling does not help on its own.* `delay30`
  adds 10 ms and fixes nothing; `range75-1000` fixes 13 trap clips of 155.
- *The team's pYIN baseline never hears the low E.* At 82 Hz pYIN's voiced
  probability peaks at 0.69 (22.05 kHz) or 0.24 (48 kHz), under
  `detect_pitch`'s 0.7 cut; the old test printed results without asserting, so
  nobody saw it. It is kept as found, as the baseline, with a strict xfail.
- *`fluxMin` 18 and 26* are now variants: on real recordings, extra events
  (re-triggers inside a ringing note) and missed plucks will show which side
  of 22 is safe. On synthetic notes all three are identical.

**Not measured yet: everything that matters.** None of the above is a guitar.
Acceptance (≥95% correct, <2% octave errors, `tests/test_dataset_accuracy.py`)
waits for `data/notes`. Until a run over recordings is exported,
`params.lab.ts` overrides nothing and the browser runs exactly Phase 1's
detector.

## 2026-11-02 — Phase 3: single-note exercises, judged by ear

**What was done.** A third kind of lesson, `notes`, in its own card and with no
camera: six exercises from the slides (`lesson/exercises.ts`), two modes (loop
on mistake, play through), a three-beat count-in, the six feedback states
(`lesson/noteJudge.ts`, worded in `ui/feedback.ts`), a tab strip, and a review
with accuracy, a mistake timeline, the most-missed note and "practise
mistakes". Sessions are saved to IndexedDB, results only. `npm run
lesson-check` plays scripted sessions through all of it.

**Decision: notes are judged by onset zone, the moment they arrive.** In play
through, each step owns the time from halfway after the previous note to
halfway before the next. A note is judged by the zone its *onset* falls in, as
soon as its message lands, so feedback is never held back until the beat has
passed; an empty zone is judged when it closes plus 300 ms (the arrival p95
was 107 ms). A pitchless onset is said at once ("didn't catch that") but leaves
the zone open for a clear pluck.

**Decision: the count-in clicks only when the guitar is plugged in.** The app
had made no sound at all. A click was the brief's requirement, and a built-in
microphone with echo cancellation off would hear it as a pluck, so with the
built-in mic the count-in is visual (big 3, 2, 1). The click is an oscillator
on the same AudioContext, so it is scheduled on the clock onsets are stamped
with; nothing is connected from the microphone onwards.

**Decision: "didn't catch that" and "signal's weak" never count.** Accuracy is
clean / (clean + wrong + timing + wrong spot). A detector that cannot hear a
note must not mark the student down for it; it says so and says what to change.

**Measured.** In the browser pane with `?debug&source=exercise` (the
exercise played by a scripted source with fixed mistakes): the review
reproduced the script exactly (three mistakes, one note not played, 7/10).
Pluck to feedback on screen: p50 70 ms; p95 305 ms over 9 notes, in a pane
whose animation frames are known to be throttled. The 200 ms goal and the
30-minute run need a real laptop; both are logged to the console
(`[session] ... latency p50 / p95`) and stored with each session.

**Wrong spot waits for Phase 4.** Audio alone cannot know the string, so that
state is only produced by fusion.

## 2026-11-02 — Phase 4: the camera says *where*, only when it can defend it

**What was done.** `src/fusion/`: `candidatesFor` (every string/fret a MIDI
note can be played at), `fuse()` (which of those has a fingertip on it at the
moment of the pluck), `TipHistory` (a 300 ms ring of fingertip readings) and
`VisionHealth` (the one-second fallback). Note exercises now run on top of the
camera when it is on: the card docks at the bottom, the neck shows the target
note hollow and the last placed note filled, and the judge can say "right
note, wrong spot". `npm run fusion-check` drives it all with synthetic hands on
a real calibrated `Fretboard`.

**Decision: audio decides the note, vision only chooses among its places.**
The camera never turns a right note into a wrong one by pitch. For each
candidate place, the nearest on-board fingertip is measured in *neck units*
(one string spacing across, one fret box along, the box itself counting as
zero). Nearest within 0.6 wins; confidence falls with distance and with a
runner-up close behind.

**Decision: an open string is the absence of a finger.** It wins only when no
fretted candidate has a finger on it and nothing presses that string between
the nut and the 12th fret. Weaker evidence, so lower confidence (0.65), below
the 0.75 a wrong-spot verdict needs: the camera can never call an open string
a mistake.

**Decision: two clocks, joined once.** Onsets are on the audio clock, hand
readings on the page clock. The note's arrival carries both, so the pluck's
page time is `arrival.perfMs - (arrival.contextTime - onset)`; the frame
nearest it is used, and none older than 300 ms.

**Measured (synthetic).** fusion-check, 2000 positions over frets 1-12 with
the other fingers hovering nearby: string/fret right on 100% of fused notes at
0.1, 0.2 and 0.35 string spacings of jitter, 98.9% with every tip also 0.4
strings off by parallax. Audio alone (lowest fret) gets 44.5% of the same
positions. The brief's ≥85% on ten recorded videos, and camera ≥15 FPS with
audio running, need the real guitar: each session now stores how many notes
were placed and how many at the target (`fusedNotes`, `fusedAtTarget`), shown
in the review.

## 2026-11-02 — Phase 5: home, setup check, practice selection, live screen

**What was done.** The start card became the home screen. First visit: three
survey questions (level, goal, favourite style; skippable, changeable later).
Then the dashboard (WF-03): continue the last exercise, three recommended
exercises each with the reason, the last five sessions, and the accuracy
trend as bars *and* in words. A setup check (WF-04) with five steps: input
(built-in or plugged in, and which device), level, room noise, a note test on
the open A string, and the camera's lighting and neck, with "skip the camera:
practise by ear". The notes card's chooser (WF-05) adds a coaching mode: pitch
only, string + fret, freestyle. The live screen (WF-07/08) gained the loop
toggle mid-session and a signal line beside the meter. `npm run home-check`.

**Decision: recommendations are rules a teacher would say out loud.** Each
exercise starts from its place in an easy-to-hard order for the student's
level, gets +3 for the goal and +2 for the style, +5.5 when the last full run
was under 70% (more than goal and style together: what went badly comes
first), and sinks to the bottom once mastered (two runs at 90% or more, so
one lucky run does not retire it). The reason shown is the rule that moved it
most. No model: the brief asked for simple rules, and rules can be explained
to the student and checked in `home-check`.

**Decision: the survey is skippable and stays in the browser.** It only
reorders recommendations; skipping it gives a beginner's order. Stored as
`guitar.profile.v1`, parsed as hostile input like every other key.

**Decision: switching loop/play-through mid-session continues from the same
note**, after a fresh count-in. Restarting would throw away the notes already
played; continuing without a count-in would put the first note of
play-through at an arbitrary point of the clock. Notes already judged stay in
the review (`lesson-check` covers both directions).

**Decision: the setup thresholds are tied to the judge, not invented.** Room
noise is "noisy" above WEAK_RMS (-50 dBFS), because then the room alone reads
as a quiet note's level; "quiet" is 10 dB under that. A good level is peaks
10 dB over WEAK_PEAK. The lighting thresholds (mean luma under 0.25 dark, over
0.8 washed out) are first guesses from how webcam auto-exposure behaves, and
say so in their comment: they need measuring on real webcams.

**Not a backend.** Accounts and sync stay out, as the brief asks, until the
user says otherwise.

**Checked in the browser pane** (`?debug&source=exercise`): survey → save →
dashboard; continue → the live screen → loop toggle mid-session (count-in
restarted at the same note) → review, with the dashboard updated behind it;
freestyle (each note named, with the three lowest places it can be played);
setup check (level, noise and note test respond; without a camera it offers
to start one). Not checked: the camera-on paths (lighting verdict, the card
docked over the neck), which need a webcam.

## 2026-11-02 — Phase 6: evaluation

The numbers, with how each was measured, are in `../docs/evaluation.md`; the
tester protocol in `../docs/tester-survey.md`. What was decided on the way:

**Camera errors say which problem it is.** "Cannot detect my camera" turned
out to be the Claude desktop browser pane, which never grants a camera. A
single "could not start the camera" message told the user nothing, so
`vision/cameraError.ts` maps the browser's error names to five cases (blocked,
missing, busy, insecure page, the hand model failed to load), each with what
to do (`home-check` covers the mapping).

**The neck is marked by hand, and the calibrator says so.** The neck detector
finds nothing on real webcams (see Neck tracking in CLAUDE.md), yet "Find it
for me" was offered first, and a user's first report was "it cannot detect
my guitar fret". The button now shows only with the experimental `autoDetect`
setting, and the intro says the neck is marked once, by hand, and followed
after that. With four clicks the user's grid lined up with their frets.

**Real guitar notes: IDMT-SMT-Guitar V2.** No recordings of ours existed, so
the lab imports the dataset's isolated, normally played notes
(`lab/import_idmt.py`; CC BY-NC-ND, evaluation only, never committed): 312
notes, two electric guitars, four pickup settings. The detector as it was:
97.1%, every miss an unnamed low note (thick E 90.4%, A 94.2%), never a wrong
one. `params.ts` had said "Phase 2 measures whether 30 ms reads better"; it
does: starting the pitch window 30 ms after the onset instead of 20 gives
99.7%, for 10 ms more latency (p50/p95 76/123 ms). Exported as the lab
override; `audio-check` agrees with the lab on 312/312 clips. `flux26` reached
100% on the same notes and was not taken: one note of 312 is not evidence,
and it raises the onset threshold, which clean DI recordings cannot judge:
that needs a noisy room and a laptop microphone.
The octave check measured worse on real notes (92%, fifth errors), so it
stays off.

**The soak excludes the test rig.** `?debug&source=soak` plays the exercises
to itself for 30 minutes. The first run showed 1150 ms frame gaps; measured,
they were the scripted source synthesising a whole performance up front
(350-925 ms per session), not the app (24 ms to open the context and
worklet). Those windows are excluded and logged as such. Two earlier soaks
were lost: one to a Vite reload after an edit in `src/`, one to the pane
being navigated. Do not edit `src/` while a soak runs.

**The soak found a privacy bug.** The first full run stopped producing
sessions at minute 22, after a 1.6 s frame gap: the window had been hidden.
That alone should only end the session; instead the chain died, because the
tab was hidden while the next exercise was still opening its microphone.
`stop()` ran with no session yet, the panel went back to the chooser, and
then `NoteListener.start()` finished and kept what it had opened: the
microphone stayed on with nobody listening, against SECURITY.md's "released
when the tab is hidden". Reproduced in the pane (an AudioContext left
running), fixed in `NoteListener` and the tuner (a `start()` overtaken by a
`stop()` releases what it opened), verified (context closed; a normal
exercise still runs). The soak now counts hidden-tab events, and a run with
any is not valid.

**The soak, clean run:** 30.2 min, 85 sessions, 1,466 notes, latency p50
85 / p95 127 ms throughout, worst frame gap 33 ms, no long tasks, heap flat.

**Still open, and why:** camera FPS on a named laptop (no webcam here), the
ten-video string/fret test, and the testers. Each has its steps in
`evaluation.md`.

## 2026-11-03 — A real chord video: the tracker followed the hand

A chord tutorial (*Bunga di Telinga*, by Faris Bakhari) became the first real
footage the camera half was measured on. `?debug&video=` plays a local file
through the real pipeline and records every frame's fingertip readings; the
ground truth is the chord diagram the video draws under the picture, read
from its pixels (Dmaj7, C#m7, Bm7 at frets 5, 4 and 2). Numbers in
`../docs/evaluation.md`, section 5.

**The neck tracker followed the fretting hand.** The neck was marked with the
hand on frets 3-7, so the anchors there were patches of skin, and when the
hand moved they moved with it, taking the grid along: every chord read at the
same fret. The consensus fit (which survives a few bad anchors) does not help
when a dozen bad anchors move together. Anchors inside the hand's landmark
box, widened by half a patch, are now skipped when the reference is taken and
while tracking. Turning tracking off was also measured: frets right, strings
one to two off, because the guitar moves; tracking stays on.

**The fingertip, not the pad.** The string is pressed by the pad, behind the
tip, so a press point between the tip and the joint behind it seemed worth
trying (chosen on half the segments, tested on the other half). It was worse
at every setting: the joint lies further toward the thin E, the side the
error already leans. The tip stays.

**What is left.** Exact string and fret 26%, fret 47%, whole chords 0% on this
video. The error is mostly across the strings (the ring finger reads 1.2
strings toward the thin E), on a camera angle that puts the strings 9 px
apart. One video is not a verdict on the camera, but it is a warning: the
"wrong spot" rules (0.75 confidence, else judge by ear) are what keep this
from turning into false corrections.

## 2026-11-03 — Bring your own tab, Phase 5: the teaching screens

Notes → **My songs** imports a tab (paste, upload or drop: text, Guitar Pro,
MusicXML, or a song exported from here), shows what was read with every
warning, lets the player fix tuning, capo, tempo, track and section names, and
then teaches it with the plan from Phase 4.

**The lesson is the note lesson.** A plan step becomes an ordinary
`NoteExercise` (`song/lesson.ts`), so the detector, the judge, the six
feedback states, the count-in, the prior and the fusion are the ones already
measured. *Wait for me* is loop mode and *play along* is play-through. Only
single sounding notes become graded steps; chords and dead notes stay on the
timeline and keep their time, because the detector hears one note at a time.
Song runs are not written to the sessions store (their ids would mean nothing
to the dashboard's recommendations); a song's progress lives with the song.

**A clean run** is one with no counted mistake and no skip, every note heard
clean, except that a hammer-on, pull-off or slide that made no onset is let off:
legato notes can be too quiet for the onset detector, and that is its limit,
not the player's. A bend is graded on the picked note and also accepts the
bent target; whether it reached the target within 30 cents (the brief's rule)
cannot be judged while pitch is read only at the pluck, so the tip says "bend
a bit further" every time instead of only when it fell short.

**The first music the app plays.** Listen is the one deliberate exception to
"the sound is the student's guitar", asked for by the brief: a plain
sawtooth pluck from its own AudioContext, on a button. While it plays the
session pauses and the microphone is ignored until 400 ms after the last note
(its ring in the room), then counts in again. `?debug&source=exercise`
cannot follow that pause (its notes are scheduled once), so a run interrupted
by Listen plays on in silence there; with a guitar it is a normal restart.

**Storage.** A separate database, `guitar-coach-songs`, so the sessions
store's version is untouched. Read back as hostile like everything else:
`parseSongRecord` recomputes every pitch from the tuning instead of trusting
the stored one. Export writes `{format: "ai-guitar-coach/song", version: 1}`
JSON; importing it makes a new record.

Not done here: the fretboard diagram of the next positions (Phase 5b, with
`FretDiagram`). Until then the next three positions are said in words, and the
camera overlay shows the target as it does for the exercises (shifted by the
capo, since tab frets count from it). `NotesPanel.ts` grew to about 640 lines
for the hooks (a song run passed to `play`, `mute`, `abandon`).

## 2026-11-05 — "It drifted": the marking, not the tracker

A student on an acoustic reported that the grid slid off the guitar after
marking the neck. Their screen recording showed otherwise: the headstock was
off the right edge of the picture, so the nut could not be clicked, and the
four clicks went around one fret box instead. That quad is about 2.5 times
taller than wide, so `orderCorners`, rightly reading the short sides as the
ends, took the box's top and bottom edges for the nut and the 12th fret. The
whole 0-12 grid sat inside one box with its frets running across the neck,
and when the guitar moved it went wherever that nonsense homography put it.
The tracker was never given a neck to follow.

Nothing in the shape alone can say "these were one fret apart", but a right
marking has a known span: nut to 12th is half the scale, about 6.5 times the
fretboard's width seen square on. `markingProblem` turns down anything under 3
(in camera pixels, not the 0-1 coordinates, whose two axes differ by the
aspect ratio) with a message saying how far apart the points belong and to
show the headstock. 3 still allows the neck to point over 60° away from the
camera, and a face-on marking on the 5th fret (about 3.6). A remembered neck is
checked too, when the camera starts and the frame's shape is known, because
the student's saved one was exactly this. `fret-check` carries the recording's
four points.

Whether the tracker then holds on that guitar is still to be seen with a
correct marking on a real camera.

## 2026-11-05 — The neck tracker, rebuilt: never draw a wrong grid

The same student sent a second recording (64 s, acoustic, laptop camera),
marked correctly this time. The grid still left the neck within seconds:
shrunk to half the neck, floating above it, across the body. Four causes, all
in `NeckTracker`: only fretboard squares were tracked, and frets repeat, so a
square matches the next fret along nearly as well; squares were matched as
cut from the marked frame, so a neck turned 15-20° stopped matching; the
search was 12 px around the last place at 10 Hz, so a quick move lost it; and
a lost tracker kept the last grid on screen indefinitely.

The rebuild, and why each piece (CLAUDE.md, "Neck tracking", has the list):
anchors on the body as well; templates warped to the current view;
half-size then full-size search at 15 Hz with the motion predicted; one shared
shift from the summed correlation maps before any anchor picks its own peak;
agreeing anchors spread along the guitar; a support check against the running
level; and `lost()` after 150 ms, which takes the grid, the readings and the
finger guidance down. Two failures only showed up on synthetic video with
known motion (now in `track-check`): with the true pose as the guess, per-anchor
peaks still settled on aliases, and after a jump a found-again fit sat three
frets out — the nut on the third fret, a stretch about the bridge by 2^(-3/12)
that lays every wire on another — with 37 of 40 anchors agreeing. Another, a
tilt along the neck with the nut off the picture, held 15 px off. Neither
consensus nor shape checks catch these; the match score over the whole guitar
does (0.53 against the truth's 0.75).

Measured. Synthetic (`track-check`, 320x153, 15 passes a second): still with
hands strumming, sliding and tipping 20°, coming 25% closer and moving 9 px a
pass all tracked with no loss, worst 0.6 px at the finger spots; a 90 px jump
with an 11° turn is lost for about half a second and found again; no
confidently wrong fit anywhere, at most two stale passes. The student's clip
(through the same code, the neck marked on the 36 s frame from its fret
inlays): 36-53 s held continuously through the student's movement, the grid
on the real wires including the 12th-fret blocks; 14-36 s found from cold in
half a second and held 56% of the time, hidden the rest (big moves, a hand
lifted off), never shown off the neck. 53-64 s lost and stayed lost: the
student leaned in and the guitar went mostly out of frame. On the frame where
it was visible again, the marked frame's squares no longer matched at any
turn or size (mean correlation 0.54, against 0.85 while tracking): the view
had changed, not just the pose. That needs extra reference views learned
while tracking, and is the next step. Cost: 7 ms a pass (p95 8), 12-20 ms
while lost, against about 3 ms before.

Not verified: a live camera. The browser pane here blocks the camera, and
throttles a hidden page to 2 fps, so the app itself was only checked for the
"lost" path and errors.


## 2026-11-05 — Learned views: holding the neck as the student leans in

Where the rebuilt tracker let go on the student's clip, it was not because
nothing matched. At 52.7 s, as they leaned in, 20-25 points still agreed on a
fit, but against the marked frame they scored 0.33-0.52 where the running
level was 0.67, so the support check turned them down and the neck stayed
lost. The marked frame had stopped looking like the guitar.

So `NeckFollower` now keeps views: the marked frame, plus a frame learned
whenever a clearly good pass (support at least 90% of its view's level, 80% of
the points agreeing) finds the neck at a pose 0.08 away from every view kept
(`poseDistance`, the nut-to-12th corners compared with the position taken
out). A learned view keeps only the points that agreed on that pass. Each pass
matches the view nearest the pose it expects, and each view keeps its own
support level, so a fresh view does not raise the bar for the old ones.

The first version drew wrong grids on synthetic video: a scene where the
guitar grows by half, turns and tips while its wood and shine change (figured
wood shows different bands from different angles), leaves the picture for a
second and comes back. Each learned view copies the error of the pass that
learned it, three views on that reached 4 px, and 2 runs in 5 drew a grid past
a quarter of the 12th fret's box. Today's tracker on the same scene: 0 in 5,
worst 1.6-2.2 px. The fix: whenever a pass was matched against a learned view,
it is refined against the marked frame, and that answer is kept if the marked
frame still sees the guitar. Learned views find the neck; the marked frame
says where it is. After that: 5 runs in 5 clean, worst 2.3-2.8 px. Learning
more often (0.05) made longer chains of views learned from views, and was
worse on both the synthetic and the real video; chains stop at depth 4.

Two changes to `track-check` on the way. The 2 px limit was a quarter of the
12th fret's box at the scene's usual size; it now follows the box
(`allowedError`), since a guitar half as big again has a box half as wide
again. And strings sliding across the frets with the view were tried and left
out: with them "where the neck is" has two answers, the wires' and the
strings', and every version showed a 2-2.5 px bias across the neck.

Measured on the student's clip (the neck marked at 36 s, no hand tracking in
the replay):

- 36-60 s: held to 53.6 s, 0.9 s further into the lean than without views.
  The grid checked by zoom at 47, 50.5, 53.0, 53.2 and 53.47 s sits on the
  real wires, the 12th-fret blocks and the 5/7/9 dots inside their boxes.
- 14-36 s, from cold: the neck shown 52%, 72% and 76% of the time over three
  runs (one run without views: 56%; the spread is in when a recovery attempt
  lands). Every grid checked (17.5, 25.5, 28.6, 33 s) was on the wires.
- 53.6 s on: still lost. Marked by hand from the fret wires at 54.5 s and
  refitted, the true pose is 0.14 away from the newest view, the body is
  under the strumming arm, and every view scores 0.13-0.18 there (the
  fretboard 0.3-0.5 a point): a pose never seen while tracking. It says so,
  and after 3 s asks for the neck to be marked again.
- Cost: 9-10 ms a pass in the replay, the same as before; the extra refine
  against the marked frame only runs when a learned view was matched.

Not verified: a live camera on a real guitar.

## 2026-11-05 — Marking the neck with the nut off the picture

"Every time the nut is off camera, the whole grid is off and I cannot see my
lesson." Nothing hid a grid the app already had when the nut left the
picture: drawing does not care, and on synthetic video the tracker held a
guitar sliding until the nut and three frets were out of frame, with a
strumming forearm over half the body, on every frame (0.1-0.7 px). The
problem was before that. Marking asks for both ends of the nut, a laptop
camera framed on the player often cannot see it, and since this morning a
marking squeezed into a few frets (what a student does when the nut cannot be
clicked) is turned down. So: no marking, no grid, no lesson.

Now the near pair can be put on a fret wire, nut to 5th, with a stepper on
the marking card — before clicking, so the steps say "Click fret 3", or after,
checked against the grid drawn live over the real wires, like the far pair
always was. `Fretboard.from` takes the near fret, builds the board from it and
keeps its corners at the nut, wherever that is, so tracking, readings and the
stored calibration are unchanged (stored corners may now lie off the picture,
-4..5). The squeeze check's least ratio scales with the span marked; honestly,
that leaves it guarding only nut-to-12th markings, since one fret box comes
out 2.5 to 1 and a turned 5th-to-12th marking can be less.

Checked in the app with the student's recording standing in for the camera
(36 s, nut just off the right edge, 1440x756): near pair set to fret 3, four
clicks on the fret-3 and 12th wires, and the saved board was within 0.4-1.2 px
of the real wires on every visible fret (2 px at the 1st, 3.6 px at the
off-picture nut; the clicks were whole screenshot pixels, about 1.8 real
ones). The grid came up numbered 2-12, and a lesson ran on it ("Play Em",
the fingers read against fret 2). `fret-check`: marked on the 3rd fret gives
the same board as marked on the nut (4e-16), and the ratio cases.

Two limits. Dots for a chord on frets the camera cannot see are off the
picture (Em at fret 2, with fret 2 at the very edge, sat at the edge under the
hand); the card's diagram still shows the chord. And the browser pane draws
about 1.5 frames a second here, so live tracking from this marking was not
watched; the tracker is the same one, and from this pose held 36-53.6 s in
the replay.

## 2026-11-05 — Chord dots off the picture: pinned to the edge, on their string

With the nut off camera, the frets a beginner chord uses are often off it
too: Em's fingers on fret 2 were simply not drawn, and the lesson looked like
it had nothing to show. Now a dot that asks for a finger and falls off the
picture is drawn at the edge, with a pointer towards where it really is, and
the overlay says "Part of this is off the picture — turn the guitar or the
camera so those frets show."

The first try kept each dot at its own height on the nearest edge. On the
student's recording (37 s, neck rising out of the right edge) that put both
Em dots in the air above the neck, on the wall, and pinned the grey
open-string markers there too. So each finger dot now carries a point further
up its own string (the 12th fret), and is drawn where the line from that
point to the dot meets the edge: on its string, at the edge, pointing up the
string. A string is a straight line in the picture (the board is a plane),
so that is exact. Open and muted strings, and "later" targets, are not
pinned: off the picture they are not drawn, as before.

Checked on the same recording at 1440x756 (fret-3 marking): both Em dots sat
on the neck at the right edge, each on its string, pointing on; no open-string
markers at the edge; the hint showed. `guidance-check` has the edge cases
(on the picture, a corner, off a side, along a string, its string off the
picture too, a canvas smaller than the inset). Not seen with a live camera.

## 2026-11-06 — "I move it a bit and the whole grid is gone": finding the neck again by its wires

On the student's recording the neck is lost at 53.7 s and never comes back.
They had shifted the guitar a little (at 55.9 s it is 21 px along the neck,
6 across and 7% bigger than at 54.2 s), and the light on it changed: at the
true pose, checked on every fret wire, the kept views scored 0.10-0.32
against 0.7 while tracking well, and fret aliases scored higher than the
truth. The fret wires were as sharp as ever (20-35 grey levels each).

So when the pictures do not know the guitar, `NeckFollower` now asks the
wires (`neckRefind.ts`): `lockToWires` fits the pose to the wires and the
board's edges from a start within half a fret, and `fretShift` reads which
fret is which from the guitar's own pattern along the neck, recorded when it
was marked (`neckInlays.ts`). What did not work, measured:

- **A whole-pattern correlation** accepted a fret alias on a synthetic board
  with no inlays (chance alone, four frets out).
- **Reading spaces 1-2**: the fretting hand's skin (4-19 spreads bright at
  marking) and its shadow (4-5 dark at 55.9 s) outvoted the 12th fret.
- **A lane's straight-line trend** read a shadow's edge as an inlay;
  **the whole width of the space** as the reference cancelled the student's
  12th-fret blocks, which span it; **a median of five nearby spaces** lost the
  dots at 3/5/7/9, which are every other space. Seven nearby spaces, the
  space itself counted, keeps both.
- **Lanes at ±0.34 only** missed the student's blocks (read at ±0.5-0.55,
  not at ±0.45); five lanes read both kinds of 12th fret.
- **Counting a mark on plain board against a shift** refused the truth when
  the student's own shadow fell on the neck (synthetic): only a mark that
  contradicts the marked view counts.
- **Recovery starts round the cycled turn-and-size guess** never locked; they
  now go along the band near the last pose.

The harness marking at 36 s used so far was 0.4 of a fret off (8 px at the
worst finger spot): locked to the wires from it, the lock jumped to the next
wire a third of the time, and every tracked pose after it carried the error,
so the wires could not lock from them either. The pose the wires and the
12th-fret blocks agree on replaces it (`wire.T36`), and the marking itself
now reads the pattern through the wires only when they agree with it.

Checks: `fretShift` on random boards (5 lanes, 18 of 75 spaces hidden):
no claims in 20000 without inlays at noise 3-6, 2-8 at noise 10; with
inlays, right 25-42% of the time, wrong 0-1 in 4000. On the real frame at
55.9 s, locks put 3 frets either side of the truth are all read right.
`track-check` gains inlays on its guitar and two scenes: the guitar shifts a
little as a shadow falls across it (found again by the wires on the same
pass: 42/42 shown, none wrong), and the same without dots (the body join
still tells the frets apart there; none wrong).

The student's recording, 36-64 s, hands tracked, from the corrected marking,
the same run with and without the wires:

- Without: lost from 53.7 s to the end (155 passes).
- With: lost 53.7-54.5 s (0.8 s), found by the wires, held to 57.6 s, then
  lost to the end (96 passes). At 55.9 s the grid has the frets in place
  along the neck (0.3-1.8 px in the middle of frets 7-12) but is too wide:
  the thin-string side is 4-10 px low at frets 1-5. That width was there
  before the pictures lost it (the grid's width against its length grew from
  1.15 at marking to 1.27-1.42 at 51-53.5 s; the truth at 55.9 s is 1.01),
  and the wires' lock keeps it: from that pose it settles 11-12 px off, from
  the truth 0.4. Looking for the edges from 0.7 of the half-width instead of
  0.92 did not change that.

Not verified: a live camera on a real guitar; guitars with dots only, maple
boards (dark dots), or no inlays at all.
