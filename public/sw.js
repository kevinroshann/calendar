self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients.find((candidate) => "focus" in candidate);
      return client ? client.focus() : self.clients.openWindow("/").then(() => undefined);
    }),
  );
});
