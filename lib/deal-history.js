// Appends to a deal's status_history audit trail without mutating the
// caller's copy — used everywhere a deal transitions state so every write
// carries a record of what happened and when.
function appendHistory(deal, entries) {
  const history = Array.isArray(deal.statusHistory) ? deal.statusHistory : [];
  return history.concat(entries);
}

module.exports = {
  appendHistory: appendHistory,
};
