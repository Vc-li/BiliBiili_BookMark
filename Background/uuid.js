let clientId;
export async function getClientId () {
    if (clientId) return clientId;
    await new Promise((resolve, reject) => {
      chrome.storage.local.get('clientId', (result) => {
        if (result.clientId) {
            clientId = result.clientId;
        } else {
            const newUuid = crypto.randomUUID()
            clientId = newUuid
            chrome.storage.local.set({ clientId: newUuid })
        }
        resolve("OK");
      })
    })
    return clientId;
}

// export async function trackEvent(event) {
//   // 打点上报
//   fetch("http://qd2.mossfrp.cn:33331/extension", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       event,
//       clientId: await getClientId(),
//       time: new Date().toISOString()
//     }),
//   }).catch(err => console.error("打点失败:", err));
// }

export let event = {
  "EXTENSION_START" : "extension_start",
  "POP_UP" : "pop_up",
  "TRACK_BEGIN" : "track_begin"
}