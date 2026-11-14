async function probeUserScripts(): Promise<boolean> {
  try {
    const api = chrome?.userScripts;
    if (!api?.getScripts) return false;
    await api.getScripts();
    return true;
  } catch {
    return false;
  }
}

void probeUserScripts().then((available) => {
  try {
    window.parent?.postMessage(
      { type: 'PAGECRAFT_USERSCRIPTS_PROBE', available },
      window.location.origin,
    );
  } catch {
    /* ignore */
  }
});
