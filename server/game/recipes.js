'use strict';

// prep: 'none' (listo tal cual) | 'chop' (tabla de cortar) | 'cook' (olla arrocera)
const INGREDIENTS = {
  nori:     { name: 'Nori',    emoji: '\u{1F958}', color: '#2f7d43', prep: 'none' },
  rice:     { name: 'Arroz',   emoji: '\u{1F35A}', color: '#f2f2ee', prep: 'cook' },
  cucumber: { name: 'Pepino',  emoji: '\u{1F952}', color: '#68b544', prep: 'chop' },
  shrimp:   { name: 'Gamba',   emoji: '\u{1F990}', color: '#ff9a76', prep: 'chop' },
  salmon:   { name: 'Salmon',  emoji: '\u{1F41F}', color: '#ff7a59', prep: 'chop' },
};

/*
 Cada receta se distingue por UN ingrediente propio ademas del arroz, para
 que se identifique de un vistazo sin tener que leer. Antes habia dos makis
 de salmon que solo se diferenciaban en el nori y se confundian.
*/
const RECIPES = [
  { id: 'nigiri_salmon', name: 'Nigiri de salmon', emoji: '\u{1F363}', items: ['rice', 'salmon'],           score: 16 },
  { id: 'nigiri_gamba',  name: 'Nigiri de gamba',  emoji: '\u{1F363}', items: ['rice', 'shrimp'],           score: 18 },
  { id: 'onigiri',       name: 'Onigiri de nori',  emoji: '\u{1F359}', items: ['rice', 'nori'],             score: 20 },
  { id: 'maki_pepino',   name: 'Maki de pepino',   emoji: '\u{1F365}', items: ['rice', 'cucumber', 'nori'], score: 28 },
];

/** Estado en el que un ingrediente se considera "listo" para emplatar. */
function readyStateOf(type) {
  const prep = INGREDIENTS[type] ? INGREDIENTS[type].prep : 'none';
  if (prep === 'chop') return 'chopped';
  if (prep === 'cook') return 'cooked';
  return 'raw';
}

function isReady(item) {
  return !!item && item.k === 'i' && item.s === readyStateOf(item.t);
}

/** Clave canonica de un conjunto de ingredientes, para comparar plato vs pedido. */
function comboKey(types) {
  return types.slice().sort().join('+');
}

const RECIPE_BY_KEY = new Map(RECIPES.map((r) => [comboKey(r.items), r]));

function matchRecipe(types) {
  return RECIPE_BY_KEY.get(comboKey(types)) || null;
}

module.exports = { INGREDIENTS, RECIPES, readyStateOf, isReady, comboKey, matchRecipe };
