/**
 * src/services/tahasusiService.js
 * Official PMO-RALG 2025 A-Level subject combinations (tahasusi).
 * Used for: profile context, suggested topics filter, career guidance.
 */
const fs = require('fs');
const path = require('path');

let _data = null;
let _byCode = null;

function load() {
  if (_data) return _data;
  const file = path.join(__dirname, '../../data/tahasusi-combinations.json');
  _data = JSON.parse(fs.readFileSync(file, 'utf8'));
  _byCode = new Map();
  for (const cat of _data.categories || []) {
    for (const comb of cat.combinations || []) {
      _byCode.set(String(comb.code).toUpperCase(), {
        ...comb,
        categoryId: cat.id,
        categoryNameEn: cat.name_en,
        categoryNameSw: cat.name_sw,
        categoryCode: cat.code,
      });
    }
  }
  return _data;
}

function listCategories() {
  return load().categories.map((c) => ({
    id: c.id,
    code: c.code,
    name_en: c.name_en,
    name_sw: c.name_sw,
    count: (c.combinations || []).length,
  }));
}

function listAll() {
  load();
  return Array.from(_byCode.values());
}

function getByCode(code) {
  if (!code) return null;
  load();
  return _byCode.get(String(code).trim().toUpperCase()) || null;
}

function search(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return listAll();
  return listAll().filter((c) => {
    if (c.code.toLowerCase().includes(q)) return true;
    if ((c.subjects || []).some((s) => s.toLowerCase().includes(q))) return true;
    if ((c.fields || []).some((f) => f.toLowerCase().includes(q))) return true;
    if ((c.categoryNameEn || '').toLowerCase().includes(q)) return true;
    if ((c.categoryNameSw || '').toLowerCase().includes(q)) return true;
    return false;
  });
}

/**
 * Build a short system-prompt block so the model stays inside the student's combination.
 */
function buildCombinationContext({ formLevel, combinationCode, preferredSubjects } = {}) {
  const form = Number(formLevel) || 0;
  const parts = [];

  if (form >= 1 && form <= 4) {
    parts.push(`Student level: Form ${form} (O-Level / CSEE track).`);
    if (Array.isArray(preferredSubjects) && preferredSubjects.length) {
      parts.push(
        `Preferred subjects: ${preferredSubjects.join(', ')}. Suggest topics and examples mainly within these subjects.`
      );
    }
  }

  if (form === 5 || form === 6) {
    parts.push(`Student level: Form ${form} (A-Level / ACSEE track).`);
    const comb = getByCode(combinationCode);
    if (comb) {
      parts.push(
        `A-Level combination (tahasusi): ${comb.code} — ${comb.subjects.join(', ')} (${comb.categoryNameEn}).`
      );
      parts.push(
        `IMPORTANT: Only teach, quiz, and suggest topics within these three subjects: ${comb.subjects.join(', ')}. Do NOT suggest topics from subjects outside this combination (e.g. do not suggest Kiswahili grammar to an HGE student).`
      );
      if (comb.fields && comb.fields.length) {
        parts.push(
          `Related career / higher-education fields for this combination: ${comb.fields.slice(0, 12).join(', ')}.`
        );
      }
    } else if (combinationCode) {
      parts.push(
        `Student reported combination code "${combinationCode}" but it was not found in the official 2025 list. Ask them to confirm their tahasusi.`
      );
    } else {
      parts.push(
        `Form ${form} student has not selected a subject combination yet. If they ask for study plans or career advice, ask them to choose their tahasusi first.`
      );
    }
  }

  return parts.length ? parts.join(' ') : '';
}

module.exports = {
  listCategories,
  listAll,
  getByCode,
  search,
  buildCombinationContext,
};
