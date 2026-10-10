import {publishNotificationActivityRefresh, subscribeNotificationActivityRefresh} from '../src/services/notifications/NotificationEvents';

test('foreground notification refresh reaches subscribed Activity screens only', () => {
  const refresh = jest.fn();
  const unsubscribe = subscribeNotificationActivityRefresh(refresh);
  publishNotificationActivityRefresh();
  expect(refresh).toHaveBeenCalledTimes(1);
  unsubscribe();
  publishNotificationActivityRefresh();
  expect(refresh).toHaveBeenCalledTimes(1);
});
