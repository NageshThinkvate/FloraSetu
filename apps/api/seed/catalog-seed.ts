// Dev-only catalog seed (Build 2). Phase-1 basket from Master as INITIAL CONFIGURATION
// EXAMPLES — all biological/commercial values are validation_status='DEMO'
// (NOT VALIDATED; subject to buyer/supplier field validation). Units are VALIDATED
// canonical structure only. Gated on NODE_ENV=development.
import { Pool } from 'pg';

if (process.env.NODE_ENV !== 'development') {
  console.error('seed is dev-only (NODE_ENV=development required)');
  process.exit(1);
}

const CATS = [
  { code: 'FLOWER', name: 'Flower', cls: 'VALIDATED' },
  { code: 'FILLER', name: 'Filler', cls: 'VALIDATED' },
  { code: 'FOLIAGE', name: 'Foliage', cls: 'VALIDATED' }
];

const PRODUCTS: {
  code: string; name: string; botanical?: string; common?: string; commercial?: string;
  category: string; aliases?: { alias: string; type: string }[];
  varieties: { name: string; colour?: string; form?: string }[];
}[] = [
  { code: 'DENDROBIUM', name: 'Dendrobium Orchid', botanical: 'Dendrobium spp.', category: 'FLOWER',
    varieties: [{ name: 'Sonia Purple', colour: 'PURPLE', form: 'CUT_FLOWER' }] },
  { code: 'ANTHURIUM', name: 'Anthurium', botanical: 'Anthurium andraeanum', category: 'FLOWER',
    varieties: [{ name: 'Red Success', colour: 'RED', form: 'CUT_FLOWER' }] },
  { code: 'GERBERA', name: 'Gerbera', botanical: 'Gerbera jamesonii', category: 'FLOWER',
    varieties: [{ name: 'Yellow Blast', colour: 'YELLOW', form: 'CUT_FLOWER' }] },
  { code: 'ROSE_PREMIUM', name: 'Premium/Dutch Rose', botanical: 'Rosa hybrida', common: 'Dutch Rose', category: 'FLOWER',
    aliases: [{ alias: 'Dutch Rose', type: 'COMMERCIAL' }, { alias: 'Hybrid Tea Rose', type: 'COMMON' }],
    varieties: [{ name: 'Red Naomi', colour: 'RED', form: 'CUT_FLOWER' }] },
  { code: 'LILIUM', name: 'Lilium', botanical: 'Lilium spp.', category: 'FLOWER',
    aliases: [{ alias: 'Oriental Lily', type: 'COMMON' }],
    varieties: [{ name: 'Siberia', colour: 'WHITE', form: 'CUT_FLOWER' }] },
  { code: 'CARNATION', name: 'Carnation', botanical: 'Dianthus caryophyllus', category: 'FLOWER',
    varieties: [{ name: 'Pink Dover', colour: 'PINK', form: 'CUT_FLOWER' }] },
  { code: 'CHRYSANTHEMUM_DISBUD', name: 'Chrysanthemum / Disbud', botanical: 'Chrysanthemum morifolium', category: 'FLOWER',
    aliases: [{ alias: 'Disbud Mum', type: 'COMMERCIAL' }],
    varieties: [{ name: 'White Disbud', colour: 'WHITE', form: 'CUT_FLOWER' }] },
  { code: 'GYPSOPHILA', name: 'Gypsophila', botanical: 'Gypsophila paniculata', common: "Baby's Breath", category: 'FILLER',
    aliases: [{ alias: "Baby's Breath", type: 'COMMON' }],
    varieties: [{ name: 'Million Stars', colour: 'WHITE', form: 'CUT_FLOWER' }] },
  { code: 'SOLIDAGO', name: 'Solidago', botanical: 'Solidago spp.', common: 'Goldenrod', category: 'FILLER',
    varieties: [{ name: 'Golden Glory', colour: 'YELLOW', form: 'CUT_FLOWER' }] },
  { code: 'LIMONIUM_STATICE', name: 'Limonium / Statice', botanical: 'Limonium sinuatum', category: 'FILLER',
    aliases: [{ alias: 'Statice', type: 'COMMON' }, { alias: 'Sea Lavender', type: 'COMMON' }],
    varieties: [{ name: 'Blue Statice', colour: 'BLUE', form: 'CUT_FLOWER' }] },
  { code: 'EUCALYPTUS', name: 'Eucalyptus', botanical: 'Eucalyptus cinerea', category: 'FOLIAGE',
    varieties: [{ name: 'Silver Dollar', form: 'CUT_FOLIAGE' }] },
  { code: 'LISIANTHUS', name: 'Lisianthus', botanical: 'Eustoma grandiflorum', category: 'FLOWER',
    aliases: [{ alias: 'Eustoma', type: 'BOTANICAL' }, { alias: 'Prairie Gentian', type: 'COMMON' }],
    varieties: [{ name: 'Arena Purple', colour: 'PURPLE', form: 'CUT_FLOWER' }] }
];

const COLOURS = ['RED', 'YELLOW', 'WHITE', 'PINK', 'PURPLE', 'BLUE', 'ORANGE', 'GREEN'];

const ATTRIBUTES = [
  ['stem_length_cm', 'Stem length', 'NUMERIC'],
  ['stem_straightness', 'Stem straightness', 'ENUM'],
  ['flower_diameter_cm', 'Flower diameter', 'NUMERIC'],
  ['bud_count', 'Bud / open-flower count', 'INTEGER'],
  ['bloom_stage', 'Bloom / opening stage', 'ENUM'],
  ['colour_conformity', 'Colour conformity', 'ENUM'],
  ['freshness', 'Freshness', 'ENUM'],
  ['damage_free', 'Free of damage', 'BOOLEAN'],
  ['disease_free', 'Free of disease symptoms', 'BOOLEAN'],
  ['pest_free', 'Free of pest evidence', 'BOOLEAN'],
  ['leaf_condition', 'Leaf condition', 'ENUM'],
  ['uniformity', 'Uniformity', 'ENUM']
];

const DEFECTS = [
  ['mechanical_damage', 'Mechanical damage', 'PHYSICAL'],
  ['browning', 'Browning', 'PHYSIOLOGICAL'],
  ['wilting', 'Wilting', 'PHYSIOLOGICAL'],
  ['disease_symptom', 'Disease symptom', 'BIOLOGICAL'],
  ['pest_damage', 'Pest damage', 'BIOLOGICAL'],
  ['stem_damage', 'Stem damage', 'PHYSICAL'],
  ['flower_damage', 'Flower damage', 'PHYSICAL'],
  ['size_nonconformity', 'Size nonconformity', 'SPECIFICATION'],
  ['colour_nonconformity', 'Colour nonconformity', 'SPECIFICATION'],
  ['bloom_stage_nonconformity', 'Bloom stage nonconformity', 'SPECIFICATION'],
  ['quantity_nonconformity', 'Quantity nonconformity', 'SPECIFICATION']
];

const UNITS = [
  ['STEM', 'Stem'], ['BUNCH', 'Bunch'], ['PIECE', 'Piece'], ['GRAM', 'Gram'],
  ['KILOGRAM', 'Kilogram'], ['BOX', 'Box'], ['CARTON', 'Carton']
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [code, name] of UNITS) {
      await client.query(
        `INSERT INTO catalog.units_of_measure (code, name, validation_status)
         VALUES ($1, $2, 'VALIDATED') ON CONFLICT (code) DO NOTHING`,
        [code, name]
      );
    }
    for (const c of CATS) {
      await client.query(
        `INSERT INTO catalog.categories (ref, code, name, validation_status)
         VALUES ('CAT-SEED-' || $1, $1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [c.code, c.name, c.cls]
      );
    }
    for (const c of COLOURS) {
      await client.query(
        `INSERT INTO catalog.colours (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
        [c, c.charAt(0) + c.slice(1).toLowerCase()]
      );
    }
    for (const [code, name, type] of ATTRIBUTES) {
      await client.query(
        `INSERT INTO catalog.quality_attributes (code, name, data_type)
         VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [code, name, type]
      );
    }
    for (const [code, name, cls] of DEFECTS) {
      await client.query(
        `INSERT INTO catalog.defect_types (code, name, defect_class)
         VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [code, name, cls]
      );
    }

    // System actor for seeded master rows (created_by is NOT NULL on versioned masters).
    const actorRes = await client.query<{ id: string }>(
      `SELECT id FROM identity.users WHERE email = $1 LIMIT 1`,
      [(process.env.ADMIN_EMAIL ?? '').toLowerCase()]
    );
    const seedActor = actorRes.rows[0]?.id ?? null;
    if (!seedActor) {
      throw new Error('run yarn seed first (owner account required as seed actor)');
    }

    for (const p of PRODUCTS) {
      const cat = await client.query<{ id: string }>(`SELECT id FROM catalog.categories WHERE code = $1`, [p.category]);
      const stemUom = await client.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = 'STEM'`);
      const commodity = await client.query<{ id: string }>(
        `INSERT INTO catalog.commodities (ref, category_id, name, botanical_name, common_name, commercial_name, default_uom_id, validation_status)
         VALUES ('PRD-SEED-' || $1, $2, $3, $4, $5, $6, $7, 'DEMO')
         ON CONFLICT (ref) DO NOTHING RETURNING id`,
        [p.code, cat.rows[0].id, p.name, p.botanical ?? null, p.common ?? null, p.commercial ?? null, stemUom.rows[0].id]
      );
      let commodityId = commodity.rows[0]?.id;
      if (!commodityId) {
        commodityId = (await client.query<{ id: string }>(
          `SELECT id FROM catalog.commodities WHERE ref = 'PRD-SEED-' || $1`, [p.code])).rows[0].id;
      }
      for (const a of p.aliases ?? []) {
        await client.query(
          `INSERT INTO catalog.product_aliases (commodity_id, alias, alias_type)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [commodityId, a.alias, a.type]
        );
      }
      for (const v of p.varieties) {
        const colourId = v.colour
          ? (await client.query<{ id: string }>(`SELECT id FROM catalog.colours WHERE code = $1`, [v.colour])).rows[0].id
          : null;
        await client.query(
          `INSERT INTO catalog.varieties (ref, commodity_id, name, colour_id, product_form, validation_status)
           VALUES ('VAR-SEED-' || $1 || '-' || $2, $3, $4, $5, $6, 'DEMO') ON CONFLICT (ref) DO NOTHING`,
          [p.code, v.name.replace(/\s+/g, '_').toUpperCase(), commodityId, v.name, colourId, v.form ?? null]
        );
      }
      // DEMO grade profile v1 (declarative rules; NOT validated for commercial use).
      await client.query(
        `INSERT INTO catalog.grade_profiles
           (commodity_id, grade_code, version_no, rules, status, effective_from, change_reason, created_by, validation_status)
         SELECT $1, 'A', 1, $2, 'ACTIVE', now(), 'Initial DEMO seed', $3, 'DEMO'
         WHERE NOT EXISTS (
           SELECT 1 FROM catalog.grade_profiles WHERE commodity_id = $1 AND grade_code = 'A' AND version_no = 1)`,
        [commodityId, JSON.stringify([
          { attribute: 'stem_length_cm', op: 'MIN', min: 40 },
          { attribute: 'damage_free', op: 'EQ', value: 'true' },
          { attribute: 'disease_free', op: 'EQ', value: 'true' }
        ]), seedActor]
      );
      // DEMO handling profile v1 — explicitly NOT VALIDATED.
      await client.query(
        `INSERT INTO catalog.handling_profiles
           (commodity_id, code, version_no, temp_min_c, temp_max_c, status, effective_from,
            change_reason, created_by, validation_status, handling_group_code)
         SELECT $1, 'DEMO_GENERAL', 1, NULL, NULL, 'ACTIVE', now(),
                'DEMO placeholder — ranges intentionally unset pending field validation', $2, 'DEMO', 'DEMO_GROUP'
         WHERE NOT EXISTS (
           SELECT 1 FROM catalog.handling_profiles WHERE commodity_id = $1 AND code = 'DEMO_GENERAL' AND version_no = 1)`,
        [commodityId, seedActor]
      );
    }

    // DEMO pack + conversion example (Premium/Dutch Rose): 1 bunch = 20 stems, product-scoped.
    const rose = await client.query<{ id: string }>(`SELECT id FROM catalog.commodities WHERE ref = 'PRD-SEED-ROSE_PREMIUM'`);
    if (rose.rowCount) {
      const bunch = await client.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = 'BUNCH'`);
      const stem = await client.query<{ id: string }>(`SELECT id FROM catalog.units_of_measure WHERE code = 'STEM'`);
      await client.query(
        `INSERT INTO catalog.unit_conversions
           (commodity_id, from_uom_id, to_uom_id, factor, version_no, status, effective_from, change_reason, created_by)
         SELECT $1, $2, $3, 20, 1, 'ACTIVE', now(), 'DEMO seed conversion (not validated)', $4
         WHERE NOT EXISTS (
           SELECT 1 FROM catalog.unit_conversions WHERE commodity_id = $1 AND from_uom_id = $2 AND to_uom_id = $3)`,
        [rose.rows[0].id, bunch.rows[0].id, stem.rows[0].id, seedActor]
      );
    }

    await client.query('COMMIT');
    console.log('catalog seed complete (DEMO classification)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
