const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw15K7lid0XYhUHG4By3mtU0-32c-oLHkORZo9ImyukP17t0ZIUDWD-I1N4ydnLuyHF/exec'

function encodePayload(data) {
  const json = JSON.stringify(data)
  const utf8 = new TextEncoder().encode(json)
  let binary = ''
  utf8.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function jsonpRequest(url, params = {}, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const callbackName = `shoppingListCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Sync timed out. Check internet connection.'))
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timeout)
      delete window[callbackName]
      if (script.parentNode) script.parentNode.removeChild(script)
    }

    window[callbackName] = (data) => {
      cleanup()
      resolve(data)
    }

    const searchParams = new URLSearchParams({
      ...params,
      callback: callbackName,
      cacheBust: String(Date.now()),
    })

    script.src = `${url}?${searchParams.toString()}`
    script.onerror = () => {
      cleanup()
      reject(new Error('Could not reach Google Sheet sync.'))
    }

    document.body.appendChild(script)
  })
}

export function requestSheet(params) {
  const { operations, ...query } = params
  if (operations) query.payload = encodePayload(operations)
  return jsonpRequest(GOOGLE_SCRIPT_URL, query)
}
