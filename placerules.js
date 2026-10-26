const LOCATION_WORDS = new Set([
  'in', 'on', 'near', 'at', 'over', 'across', 'outside', 'around', 'toward',
  'towards', 'into', 'central', 'northern', 'southern', 'eastern', 'western',
  'north', 'south', 'east', 'west', 'front', 'frontline', 'capital'
]);

const ACTION_VERBS = new Set([
  'hits', 'hit', 'strikes', 'struck', 'bombards', 'pounds', 'pounded', 'attacks',
  'attacked', 'shells', 'shelled', 'targets', 'targeted', 'bombs', 'bombed',
  'batters', 'hammers', 'rocks', 'rocked', 'devastates', 'reaches', 'enters',
  'captures', 'captured', 'seizes', 'liberates', 'liberated', 'storms',
  'besieges', 'evacuates', 'evacuated', 'threatens'
]);

const AREA_WORDS = new Set([
  'region', 'oblast', 'district', 'area', 'suburbs', 'outskirts', 'front',
  'direction', 'sector', 'city'
]);

const SUBJECT_VERBS = new Set([
  'says', 'said', 'rebuts', 'rejects', 'targets', 'reported', 'reports', 'claims',
  'warns', 'confirms', 'denies', 'accuses', 'urges', 'wants', 'seeks', 'asks',
  'agrees', 'insists', 'demands', 'calls', 'hopes', 'plans', 'expects', 'weighs',
  'offers', 'responds', 'replied', 'blames', 'ready', 'is', 'has', 'will', 'may',
  'could', 'must', 'to', 'announces', 'approves', 'signs', 'sends', 'receives',
  'gets', 'orders', 'appeals', 'pledges', 'vows'
]);

const PUBLICATION_WORDS = new Set(['post', 'independent']);

const METONYM_PRONE = new Set(['Kyiv']);

const INDEX_PAGE = [
  /^ukraine war news today/i,
  /top stories and breaking updates/i
];

function isIndexPage(title) {
  return INDEX_PAGE.some(rx => rx.test(title));
}

function tokenize(text) {
  return (text.match(/[A-Za-z][A-Za-z'’]*/g) || []).map(raw => ({
    t: raw.replace(/['’]s$/i, ''),
    poss: /['’]s$/i.test(raw)
  }));
}

function mentions(text, lookup) {
  const tokens = tokenize(text);
  const found = [];
  let i = 0;
  while (i < tokens.length) {
    let hit = null;
    for (let n = Math.min(3, tokens.length - i); n >= 1; n--) {
      const slice = tokens.slice(i, i + n).map(x => x.t);
      if (!slice.every(t => /^[A-Z]/.test(t))) continue;
      const place = lookup(slice);
      if (place) {
        hit = { place, n };
        break;
      }
    }
    if (hit) {
      found.push({
        place: hit.place,
        prev: (tokens[i - 1] ? tokens[i - 1].t : '').toLowerCase(),
        next: (tokens[i + hit.n] ? tokens[i + hit.n].t : '').toLowerCase(),
        poss: tokens[i + hit.n - 1].poss
      });
      i += hit.n;
    } else {
      i++;
    }
  }
  return found;
}

function hasPlaceContext(m) {
  if (m.poss && METONYM_PRONE.has(m.place.name) && !ACTION_VERBS.has(m.prev) && !AREA_WORDS.has(m.next)) {
    return false;
  }
  return LOCATION_WORDS.has(m.prev) || ACTION_VERBS.has(m.prev) || AREA_WORDS.has(m.next);
}

function titleMentionOk(m) {
  if (PUBLICATION_WORDS.has(m.next)) return false;
  if (METONYM_PRONE.has(m.place.name)) {
    return hasPlaceContext(m) && !SUBJECT_VERBS.has(m.next);
  }
  return true;
}

function snippetMentionOk(m) {
  if (PUBLICATION_WORDS.has(m.next)) return false;
  if (SUBJECT_VERBS.has(m.next)) return false;
  return hasPlaceContext(m);
}

function distinct(list) {
  const seen = new Map();
  list.forEach(m => {
    if (!seen.has(m.place.name)) seen.set(m.place.name, m.place);
  });
  return [...seen.values()];
}

function locatePlace(title, description, info, lookup) {
  if (isIndexPage(title) || !info.eventSignal) return null;

  const inTitle = distinct(mentions(title, lookup).filter(titleMentionOk));
  if (inTitle.length === 1) return inTitle[0];
  if (inTitle.length > 1) return null;

  if (info.type === 'diplomatic') return null;

  const all = mentions(description, lookup);
  if (distinct(all).length !== 1) return null;
  return all.some(snippetMentionOk) ? all[0].place : null;
}

module.exports = { locatePlace, isIndexPage };