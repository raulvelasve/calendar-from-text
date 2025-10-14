chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setOptions({
    path: "sidepanel.html",
    enabled: true,
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  // Al hacer clic en el icono de la extensión, abre el side panel en esa ventana
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
