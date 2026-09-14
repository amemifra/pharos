/**
 * Curated Wikimedia Commons portraits for popular artists.
 *
 * Why: the home "Popular artists" shelf used to point at
 * archive.org/services/img/<name>, which for classical composers returns the
 * generic archive.org placeholder (the "temple" icon) — archive.org has no
 * item covers for these public-domain artists. Wikimedia Commons hosts the
 * community-accepted public-domain portraits (same source the Wikipedia lead
 * image uses, see lib/artistimage.js), pinned here as 330px thumbnails so the
 * home shelf renders real portraits with zero API calls and no layout shift.
 *
 * All URLs verified reachable (HTTP 200, image/*). If an URL ever breaks the
 * card falls back to the archive.org image (temple icon) via onerror.
 * Credit line: IMAGES_CREDIT (attribution required by Wikimedia Commons).
 */

export const IMAGES_CREDIT = "Images: Wikimedia Commons";

/**
 * Artist name → Wikimedia Commons thumbnail URL.
 * Names match the canonical catalog spelling (see lib/popularity.js canon).
 * @type {Record<string, string>}
 */
export const ARTIST_PORTRAITS = {
  "Ludwig van Beethoven":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6e/Joseph_Karl_Stieler%27s_Beethoven_mit_dem_Manuskript_der_Missa_solemnis.jpg/330px-Joseph_Karl_Stieler%27s_Beethoven_mit_dem_Manuskript_der_Missa_solemnis.jpg",
  "Frédéric Chopin":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e8/Frederic_Chopin_photo.jpeg/330px-Frederic_Chopin_photo.jpeg",
  "Richard Wagner":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/RichardWagner.jpg/330px-RichardWagner.jpg",
  "Pyotr Ilyich Tchaikovsky":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Tchaikovsky_by_Reutlinger_%28cropped%29.jpg/330px-Tchaikovsky_by_Reutlinger_%28cropped%29.jpg",
  "Giuseppe Verdi":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Giuseppe_Verdi_by_Ferdinand_Mulnier_BW.jpg/330px-Giuseppe_Verdi_by_Ferdinand_Mulnier_BW.jpg",
  "Antonio Vivaldi":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Vivaldi.jpg/330px-Vivaldi.jpg",
  "Irving Berlin":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Irving_Berlin_NYWTS.jpg/330px-Irving_Berlin_NYWTS.jpg",
  "Wolfgang Amadeus Mozart":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ad/The_Mozart_Family_-_Wolfgang_Amadeus_Mozart_headshot.jpg/330px-The_Mozart_Family_-_Wolfgang_Amadeus_Mozart_headshot.jpg",
  "Johann Sebastian Bach":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Johann_Sebastian_Bach.jpg/330px-Johann_Sebastian_Bach.jpg",
  "Johannes Brahms":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cc/JohannesBrahms_%28cropped%29.jpg/330px-JohannesBrahms_%28cropped%29.jpg",
  "Franz Schubert":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Franz_Schubert_by_Wilhelm_August_Rieder_1875.jpg/330px-Franz_Schubert_by_Wilhelm_August_Rieder_1875.jpg",
  "Franz Liszt":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Franz_Liszt_by_Herman_Biow-_1843.png/330px-Franz_Liszt_by_Herman_Biow-_1843.png",
  "Claude Debussy":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Claude_Debussy_by_Atelier_Nadar.jpg/330px-Claude_Debussy_by_Atelier_Nadar.jpg",
  "George Frideric Handel":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/George_Frideric_Handel_by_Balthasar_Denner.jpg/330px-George_Frideric_Handel_by_Balthasar_Denner.jpg",
  "Joseph Haydn":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Joseph_Haydn.jpg/330px-Joseph_Haydn.jpg",
  "Gustav Mahler":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/06/Photo_of_Gustav_Mahler_by_Moritz_N%C3%A4hr_01.jpg/330px-Photo_of_Gustav_Mahler_by_Moritz_N%C3%A4hr_01.jpg",
  "Sergei Rachmaninoff":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/be/Sergei_Rachmaninoff_cph.3a40575.jpg/330px-Sergei_Rachmaninoff_cph.3a40575.jpg",
  "Gioachino Rossini":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Rossini_young-circa-1815.jpg/330px-Rossini_young-circa-1815.jpg",
  "Robert Schumann":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Robert_Schumann_1839.jpg/330px-Robert_Schumann_1839.jpg",
  "Felix Mendelssohn":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Felix_Mendelssohn_Bartholdy_by_Eduard_Magnus_%281833%29.jpg/330px-Felix_Mendelssohn_Bartholdy_by_Eduard_Magnus_%281833%29.jpg",
  "Edvard Grieg":
    "https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Edvard_Grieg_portrait_%28cropped%29.jpg/330px-Edvard_Grieg_portrait_%28cropped%29.jpg",
};

/**
 * Portrait for an artist: curated Commons portrait first, then the
 * community-curated Wikipedia lead image (lib/artistimage.js, cached in the
 * shared catalog), otherwise null (caller keeps its own fallback).
 * @param {string} name Artist name.
 * @returns {Promise<string|null>} Image URL or null. Never throws.
 */
export async function artistPortrait(name) {
  if (!name) return null;
  const curated = ARTIST_PORTRAITS[name];
  if (curated) {
    // Seed the shared catalog cache so the artist detail page reuses the
    // same portrait without a second Wikipedia round-trip.
    try {
      const store = await import("./catalogstore.js");
      if (!(await store.catalogGet(store.keys.artistImage(name)))) {
        store.catalogSet(store.keys.artistImage(name), curated);
      }
    } catch {}
    return curated;
  }
  try {
    const { artistImage } = await import("./artistimage.js");
    return await artistImage(name);
  } catch {}
  return null;
}
