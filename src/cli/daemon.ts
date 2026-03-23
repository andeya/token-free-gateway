export async function startDaemon() { console.log("start..."); }
export async function stopDaemon() { console.log("stop..."); }
export async function restartDaemon() { await stopDaemon(); await startDaemon(); }
export async function statusDaemon() { console.log("status: unknown"); }
