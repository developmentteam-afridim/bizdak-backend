const prisma = require('../utils/prisma');
/**
 * GET /api/stores/:id/deals/new?since=ISO_DATE
 *
 * Returns currently-ACTIVE deals for a store. Public endpoint — no user
 * identity, no auth required. The mobile app calls this only after passing
 * mute/snooze checks on geofence entry.
 *
 * NOTE: this historically filtered to deals CREATED after `since`, which
 * silently prevented re-notification — a still-active deal created before the
 * user's last visit could never fire again, so frequently-visited stores went
 * permanently silent. The app now enforces a per-store notification cooldown
 * (60 days) on-device, so the backend simply reports whether the store has any
 * currently-active deal. `since` is still accepted for backward compatibility
 * but no longer gates results by creation date.
 */
async function getNewDeals(req, res, next) {
  try {
    const { id } = req.params;
    const { since } = req.query;
    // `since` remains accepted for backward compatibility but no longer filters
    // by creation date. Validate only if provided.
    if (since) {
      const sinceDate = new Date(since);
      if (isNaN(sinceDate.getTime())) {
        return res.status(400).json({ error: '`since` must be a valid ISO 8601 datetime.' });
      }
    }
    // Verify store exists — findFirst with minimal select is faster than count
    const storeExists = await prisma.store.findFirst({ where: { id }, select: { id: true } });
    if (!storeExists) return res.status(404).json({ error: 'Store not found.' });
    const now = new Date();
    const deals = await prisma.deal.findMany({
      where: {
        storeId: id,
        isActive: true,
        AND: [
          { OR: [{ endDate:   { gt: now } }, { endDate:   null }] },  // not expired (incl. open-ended)
          { OR: [{ startDate: { lte: now } }, { startDate: null }] }, // already started
        ],
        // NOTE: no createdAt filter — any currently-active deal qualifies so a
        // previously-seen deal can re-notify after the app-side cooldown passes.
      },
      select: {
        id: true,
        title: true,
        titleFr: true, // used by NotificationService for French proximity notification body
        discountPercent: true,
        imageUrl: true, // used by NotificationService to show deal image in proximity notifications
        createdAt: true,
        tags: { select: { tag: { select: { name: true, slug: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      storeId: id,
      since:  since ? new Date(since).toISOString() : null, // echoed back; not used for filtering
      count:  deals.length,
      hasNew: deals.length > 0,
      deals: deals.map((d) => ({
        id: d.id,
        title: d.title,
        titleFr: d.titleFr || null,
        discountPercent: d.discountPercent,
        imageUrl: d.imageUrl || null,
        tags: d.tags.map((dt) => dt.tag),
      })),
    });
  } catch (err) {
    next(err);
  }
}
module.exports = { getNewDeals };
