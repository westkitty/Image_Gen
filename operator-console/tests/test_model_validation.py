#!/usr/bin/env python3
import sys
import time
import json
import secrets
import threading
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:31337"
HEADERS = {
    "Origin": BASE_URL,
    "X-Dex-Request": "1",
    "Content-Type": "application/json",
}

def make_rid():
    return "cr_" + secrets.token_hex(16)

def create_session(model_name):
    req = urllib.request.Request(
        f"{BASE_URL}/api/chat/sessions",
        data=json.dumps({"model": model_name}).encode("utf-8"),
        headers=HEADERS,
        method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data["session_id"]

def cancel_job_async(job_id):
    def _cancel():
        time.sleep(0.5)
        print(f"\n[Cancelling job {job_id} via /api/jobs/{job_id}/cancel]...")
        req = urllib.request.Request(
            f"{BASE_URL}/api/jobs/{urllib.parse.quote(job_id)}/cancel",
            data=json.dumps({"reason": "Stopped by test"}).encode("utf-8"),
            headers=HEADERS,
            method="POST"
        )
        try:
            with urllib.request.urlopen(req) as r:
                resp_data = json.loads(r.read().decode("utf-8"))
                print(f"[Cancel response: {resp_data}]")
        except Exception as e:
            print(f"[Cancel request error: {e}]")
    t = threading.Thread(target=_cancel)
    t.daemon = True
    t.start()

def stream_chat(session_id, content, on_delta=None, auto_cancel=False):
    rid = make_rid()
    payload = {
        "session_id": session_id,
        "request_id": rid,
        "action": "send",
        "content": content
    }
    req = urllib.request.Request(
        f"{BASE_URL}/api/ollama/chat/stream",
        data=json.dumps(payload).encode("utf-8"),
        headers=HEADERS,
        method="POST"
    )
    
    t0 = time.time()
    t_first_token = None
    deltas = []
    job_id = None
    terminal_event = None
    cancel_triggered = False
    
    with urllib.request.urlopen(req) as resp:
        buffer = ""
        while True:
            chunk = resp.read(128)
            if not chunk:
                break
            buffer += chunk.decode("utf-8", errors="replace")
            while "\n\n" in buffer:
                frame, buffer = buffer.split("\n\n", 1)
                lines = frame.strip().split("\n")
                ev_type = None
                ev_data = None
                for line in lines:
                    if line.startswith("event: "):
                        ev_type = line[7:].strip()
                    elif line.startswith("data: "):
                        try:
                            ev_data = json.loads(line[6:].strip())
                        except Exception:
                            pass
                
                if ev_data and "job_id" in ev_data and ev_data["job_id"]:
                    job_id = ev_data["job_id"]
                    if auto_cancel and not cancel_triggered:
                        cancel_triggered = True
                        cancel_job_async(job_id)
                    
                if ev_type == "delta":
                    if t_first_token is None:
                        t_first_token = time.time()
                    text_chunk = ev_data.get("text", ev_data.get("delta", ""))
                    deltas.append(text_chunk)
                    if on_delta:
                        on_delta(text_chunk)
                elif ev_type in ("done", "stopped", "error"):
                    terminal_event = (ev_type, ev_data)
                    break
            if terminal_event:
                break

    t_end = time.time()
    full_text = "".join(deltas)
    ttft = (t_first_token - t0) if t_first_token else None
    total_time = t_end - t0
    gen_time = (t_end - t_first_token) if t_first_token else total_time
    
    return {
        "text": full_text,
        "ttft": ttft,
        "total_time": total_time,
        "gen_time": gen_time,
        "job_id": job_id,
        "terminal": terminal_event,
        "char_count": len(full_text),
    }

if __name__ == "__main__":
    model = sys.argv[1] if len(sys.argv) > 1 else "dex-rocinante:12b-v1.1-q4km"
    mode = sys.argv[2] if len(sys.argv) > 2 else "turn1"
    
    sid = create_session(model)
    print(f"Created session {sid} for model {model}")
    
    if mode == "turn1":
        res = stream_chat(sid, "Write exactly two sentences about a star voyager who found a glowing crystal. Mention the word AZURE-STAR.", on_delta=lambda d: sys.stdout.write(d))
        print("\n\n--- Turn 1 Result ---")
        print(f"TTFT: {res['ttft']:.2f}s | Total Time: {res['total_time']:.2f}s | Chars: {res['char_count']} | Terminal: {res['terminal'][0] if res['terminal'] else 'none'}")
    elif mode == "context":
        print("Turn 1: Sending secret word PHOENIX-99...")
        res1 = stream_chat(sid, "Remember this secret code: PHOENIX-99. Acknowledge with OK.", on_delta=lambda d: sys.stdout.write(d))
        print("\nTurn 2: Asking for the secret code...")
        res2 = stream_chat(sid, "What was the exact secret code I asked you to remember?", on_delta=lambda d: sys.stdout.write(d))
        print("\n\n--- Context Test Result ---")
        found = "PHOENIX-99" in res2["text"]
        print(f"Code found in Turn 2: {found} (Text: {res2['text']})")
    elif mode == "cancel":
        print("Testing cancellation...")
        res = stream_chat(sid, "Write a 500-word epic poem about the creation of the stars and galaxies.", on_delta=lambda d: sys.stdout.write(d), auto_cancel=True)
        print(f"\nTerminal event: {res['terminal'][0] if res['terminal'] else 'none'}")
