/**
 * Writes the Guitar Pro fixtures of test/tabs/ from alphaTex sources, so the
 * binary files can be rebuilt and reviewed as text.
 *
 *   node scripts/make-score-fixtures.mjs
 *
 * Both riffs are original, written for the checks. Re-run after changing a
 * source, then `npm run tab-check -- --show <name>` and update the
 * .expected.json by hand once the reading has been checked.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import * as alphaTab from "@coderline/alphatab";

const SOURCES = {
  // 3/4, one track: hammer and pull, a slide, vibrato, a bend and release
  // tied over, a chord, palm mutes, a dead note, harmonics, a triplet.
  "20-waltz-steps.gp": `
    \\title "Waltz Steps" \\artist "Test Riffs (original)" \\tempo 84
    \\track "Lead" \\staff {tabs} \\instrument 25 \\tuning (E4 B3 G3 D3 A2 E2)
    \\ts (3 4) \\section "Intro" \\ro 3.5{h}.4 5.5{h}.4 3.5.4 |
    \\rc 2 2.4{sl}.4 4.4.4 4.4{v}.4 |
    \\section "Theme" 5.2{b (0 4 0)}.2 -.2.4 |
    (0.1 1.2 0.3).4 0.6{pm}.8 0.6{pm}.8 0.6{x}.4 |
    12.1{nh}.4 12.2{nh}.4 7.3{nh}.4 |
    3.4.8{tu 3} 5.4.8{tu 3} 7.4.8{tu 3} 5.4.2 |`,
  // Two tracks, bass first: the reader must default to the guitar. Drop D,
  // capo 2, and a tempo change in the last bar.
  "21-two-tracks.gp": `
    \\title "Two Parts" \\artist "Test Riffs (original)" \\tempo 110
    \\track "Bass" \\staff {tabs} \\instrument 33 \\tuning (G2 D2 A1 E1)
    0.4.2 3.4.2 | 5.4.1 | \\tempo 140 0.4.1 |
    \\track "Rhythm" \\staff {tabs} \\instrument 29 \\tuning (E4 B3 G3 D3 A2 D2) \\capo 2
    (0.6 0.5 0.4).4 (0.6 0.5 0.4).4 (5.6 5.5 5.4).2 | (3.6 3.5 3.4).2 (0.6 0.5 0.4).2 | 0.6.4 0.6.4 0.6.4 0.6.4 |`,
};

const settings = new alphaTab.Settings();
for (const [file, tex] of Object.entries(SOURCES)) {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, settings);
  const bytes = new alphaTab.exporter.Gp7Exporter().export(importer.readScore(), settings);
  writeFileSync(join(process.cwd(), "test", "tabs", file), bytes);
  console.log(`${file}  ${bytes.length} bytes`);
}
