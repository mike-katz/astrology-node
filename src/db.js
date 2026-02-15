const knex = require('knex');
require('dotenv').config();

const config = require('../knexfile');
const db = knex(config.development);

/** Soft-delete: deleted_at IS NULL (live records). Empty string invalid for PostgreSQL timestamp. */
function liveFilter(column = 'deleted_at') {
  return function () {
    this.whereNull(column);
  };
}
/** Auto-add created_at (NOW()) to every insert so one place controls all. */
(function patchInsertWithCreatedAt() {
  const builder = db('_');
  const QB = builder.constructor;
  const origInsert = QB.prototype.insert;
  QB.prototype.insert = function (data) {
    if (typeof data === 'function') return origInsert.call(this, data);
    const withCreatedAt = (row) => {
      if (row && typeof row === 'object' && !Array.isArray(row) && Object.prototype.toString.call(row) === '[object Object]') {
        return { ...row, created_at: db.raw('NOW()') };
      }
      return row;
    };
    const newData = Array.isArray(data) ? data.map(withCreatedAt) : withCreatedAt(data);
    return origInsert.call(this, newData);
  };
})();


/**
 * Live records only (single table).
 * Join ma: db.live() na use karo; db().join().where(db.liveFilter('alias.deleted_at')) use karo.
 * Example:
 *   db('orders as o')
 *     .join('faqs as f', 'f.id', 'o.faq_id')
 *     .where(db.liveFilter('o.deleted_at'))
 *     .where(db.liveFilter('f.deleted_at'))
 */
function live(table, column = 'deleted_at') {
  return db(table).where(liveFilter(column));
}

db.liveFilter = liveFilter;
db.live = live;
module.exports = db;