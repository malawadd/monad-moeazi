import { mockPerpVenueFacade } from "./mockPerpVenueFacade.js";
import { perplVenueFacade } from "./perplVenueFacade.js";
import { perplDirectVenueFacade } from "./perplDirectVenueFacade.js";
import { hasVenueAdapter, registerVenueAdapter } from "./venueRegistry.js";

export function registerPerpVenues() {
  if (!hasVenueAdapter(mockPerpVenueFacade.venueId)) registerVenueAdapter(mockPerpVenueFacade);
  if (!hasVenueAdapter(perplVenueFacade.venueId)) registerVenueAdapter(perplVenueFacade);
  if (!hasVenueAdapter(perplDirectVenueFacade.venueId)) registerVenueAdapter(perplDirectVenueFacade);
}
