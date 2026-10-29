import { logApi } from "../js/shared/apiLog.js";
import { readShareToken, clearShareToken } from "../js/shared/shareSession.js";
import { getLoggedInUser } from "../js/shared/api.js";
export class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async ensureSession() {
    return true;
  }

  authHeaders() {
    const shareToken = readShareToken();
    if (shareToken) return { Authorization: `Bearer ${shareToken}` };
    if (getLoggedInUser()?.uuid) return {};
    return { Authorization: 'Legacy 1' };
  }

  async post(endpoint, data, test,what) {
    const url = `${this.baseUrl}${endpoint}`;
    console.log(what)
    let that = '';
    if(what == undefined)
    {
      that = '';
    }
    const downloadLabel = what === undefined ? '' : `Downloading: ${what} | `;

    const send = () => fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify(data)
    });

    const response = await send();

    logApi(response, `POST ${endpoint}`);
    if (!response.ok) {
      if (response.status == 500 || response.status == 404) {
        return 'stl';
      }
      if (response.status === 401) clearShareToken();
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (test) {
      return true;
    }

    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      // Chunked transfer encoding — no progress bar possible. Nothing to tear
      // down: the container below doesn't exist yet, and touching it threw TDZ.
      return response.json();
    }

    const totalBytes = parseInt(contentLength, 10);
    let loadedBytes = 0;
    const els = window.viewerLoadingEls;

    // Shared UI state for the fallback local overlay
    let container = null, progressBar = null, percentage = null, displayBox = null;

    if (els) {
      // Use the centralized loading screen — identical update pattern to main branch
      progressBar = els.progressBar;
      percentage  = els.percentage;
      displayBox  = els.displayBox;
      progressBar.max = totalBytes;
      progressBar.value = 0;
      progressBar.style.display = 'block';
    } else {
      container = document.createElement('div');
      container.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;';
      progressBar = document.createElement('progress');
      progressBar.max = totalBytes;
      progressBar.style.cssText = 'width:80%;margin-bottom:10px;';
      percentage = document.createElement('span');
      percentage.style.cssText = 'display:block;margin-bottom:10px;';
      displayBox = document.createElement('div');
      displayBox.style.cssText = 'width:80%;padding:10px;border:transparent;border-radius:5px;background:transparent;text-align:center;min-height:100px;box-sizing:border-box;';
      container.appendChild(progressBar);
      container.appendChild(percentage);
      container.appendChild(displayBox);
      document.body.appendChild(container);
    }

    const reader = response.body.getReader();
    const stream = new ReadableStream({
      start(controller) {
        function push() {
          reader.read().then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            loadedBytes += value.length;
            progressBar.value = loadedBytes;

            const percent = ((loadedBytes / totalBytes) * 100).toFixed(2);
            percentage.textContent = `${percent}%`;

            const timeElapsed = performance.now() / 1000;
            const downloadSpeedMBps = (loadedBytes / (1024 * 1024 * timeElapsed)).toFixed(1);
            displayBox.textContent = `${downloadLabel}   Download speed: ${downloadSpeedMBps} MB/s`;

            controller.enqueue(value);
            push();
          });
        }
        push();
      }
    });

    const responseStream = new Response(stream);
    const jsonResponse = await responseStream.json();

    if (container) document.body.removeChild(container);

    return jsonResponse;
  }
}
