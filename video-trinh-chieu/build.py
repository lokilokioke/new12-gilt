#!/usr/bin/env python3
"""Dựng video trình chiếu đám cưới Việt Anh & Lan Vi (1920x1080, 25fps, có nhạc nền).
Chạy:  python3 build.py   ->  tao ra  video-trinh-chieu-dam-cuoi.mp4
"""
import os, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "..", "files (12)", "thiep-cuoi-viet-anh-lan-vi", "images")
MUSIC = os.path.join(HERE, "..", "files (12)", "thiep-cuoi-viet-anh-lan-vi", "nhac-cuoi-v2.mp3")
EXTRA = os.path.join(HERE, "anh-them")
OUT = os.path.join(HERE, "video-trinh-chieu-dam-cuoi.mp4")
FONT = "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf"
FONT_R = "/usr/share/fonts/truetype/freefont/FreeSerif.ttf"

W, H, FPS = 1920, 1080, 25
D = 10.5        # thời lượng mỗi ảnh (giây)
XF = 1.0        # thời gian chuyển cảnh
BOX_W, BOX_H = 1600, 1000

# Thứ tự kể chuyện: phòng chụp kem -> phòng trắng -> nét xưa -> khu vườn -> hoàng hôn
PHOTOS = [
    f"{IMG}/chu-re.jpg", f"{IMG}/co-dau.jpg", f"{EXTRA}/them-5.jpg",
    f"{IMG}/nguoi-linh-1.jpg", f"{IMG}/nguoi-linh-2.jpg", f"{IMG}/nguoi-linh-3.jpg",
    f"{IMG}/trang-2.jpg", f"{IMG}/trang-3.jpg",
    f"{IMG}/net-xua.jpg", f"{EXTRA}/them-3.jpg", f"{EXTRA}/them-2.jpg", f"{EXTRA}/them-4.jpg",
    f"{IMG}/vuon-3.jpg", f"{IMG}/vuon-2.jpg", f"{IMG}/vuon-1.jpg",
    f"{IMG}/nang-1.jpg", f"{IMG}/nang-2.jpg", f"{IMG}/nang-3.jpg", f"{IMG}/hero.jpg",
    f"{IMG}/hoang-hon-2.jpg", f"{EXTRA}/them-1.jpg",
]

def run(cmd):
    subprocess.run(cmd, check=True)

def dims(p):
    o = subprocess.check_output(["ffprobe","-v","error","-select_streams","v:0",
        "-show_entries","stream=width,height","-of","csv=p=0",p]).decode().strip().split(",")
    return int(o[0]), int(o[1])

def even(x): return int(x) // 2 * 2

def bg_chain(dark):
    return (f"[a]scale=480:270:force_original_aspect_ratio=increase,crop=480:270,gblur=sigma=12,"
            f"scale={W}:{H},eq=brightness={dark}:saturation=1.05[bg]")

def photo_clip(path, idx, tmp):
    w, h = dims(path)
    s = min(BOX_W / w, BOX_H / h)
    fw, fh = even(w * s), even(h * s)
    n = int(D * FPS)
    zin = idx % 2 == 0
    z = f"1+0.07*on/{n}" if zin else f"1.07-0.07*on/{n}"
    fc = (f"[0:v]split[a][b];{bg_chain(-0.10)};"
          f"[b]scale={fw*2}:{fh*2},zoompan=z='{z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d={n}:s={fw}x{fh}:fps={FPS}[fg];"
          f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p")
    out = os.path.join(tmp, f"c{idx:02d}.mp4")
    run(["ffmpeg","-v","error","-y","-i",path,"-filter_complex",fc,"-t",str(D),
         "-r",str(FPS),"-c:v","libx264","-crf","17","-preset","medium",out])
    return out

def text_clip(path, name, dur, lines, tmp, blur=False, dark=-0.25):
    """lines: (text, fontfile, size, y, start, color)"""
    dt = []
    for text, font, size, y, start, color in lines:
        text = text.replace(":", r"\:").replace("'", r"\'")
        dt.append(f"drawtext=fontfile={font}:text='{text}':fontsize={size}:fontcolor={color}:"
                  f"x=(w-text_w)/2:y={y}:shadowcolor=black@0.5:shadowx=2:shadowy=2:"
                  f"alpha='min(1,max(0,(t-{start})/1.2))'")
    if blur:
        base = (f"scale=480:270:force_original_aspect_ratio=increase,crop=480:270,gblur=sigma=12,scale={W}:{H}")
    else:
        base = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}"
    vf = f"{base},eq=brightness={dark}:saturation=1.05,{','.join(dt)},format=yuv420p"
    out = os.path.join(tmp, f"{name}.mp4")
    run(["ffmpeg","-v","error","-y","-loop","1","-framerate",str(FPS),"-t",str(dur),"-i",path,
         "-vf",vf,"-r",str(FPS),"-c:v","libx264","-crf","17",out])
    return out

def main():
    with tempfile.TemporaryDirectory() as tmp:
        title = text_clip(f"{IMG}/hoang-hon-2.jpg", "title", 7, [
            ("Chúng mình cưới!", FONT, 66, 320, 0.8, "white@0.95"),
            ("Việt Anh  &  Lan Vi", FONT, 150, 430, 1.6, "white"),
            ("18 · 10 · 2026", FONT_R, 60, 640, 2.8, "white@0.95"),
        ], tmp, blur=True, dark=-0.30)
        clips = [title] + [photo_clip(p, i, tmp) for i, p in enumerate(PHOTOS)]
        end = text_clip(f"{EXTRA}/them-1.jpg", "end", 9, [
            ("Cảm ơn bạn đã đến chung vui", FONT, 78, 340, 0.8, "white"),
            ("Việt Anh  &  Lan Vi", FONT, 140, 470, 1.8, "white"),
            ("18 · 10 · 2026", FONT_R, 56, 660, 3.0, "white@0.95"),
        ], tmp, blur=True, dark=-0.30)
        clips.append(end)

        durs = [7] + [D] * len(PHOTOS) + [9]
        total = sum(durs) - XF * (len(durs) - 1)
        inputs = []
        for c in clips: inputs += ["-i", c]
        trans = ["fade", "dissolve", "fade", "smoothleft"]
        parts, last, acc = [], "[0:v]", durs[0]
        for i in range(1, len(clips)):
            off = acc - XF
            lab = f"[v{i}]"
            parts.append(f"{last}[{i}:v]xfade=transition={trans[i%len(trans)] if i%5==0 else 'fade'}:duration={XF}:offset={off:.2f}{lab}")
            last, acc = lab, off + durs[i]
        fc = ";".join(parts)
        a = len(clips)
        af = f"afade=t=in:d=2,afade=t=out:st={total-6:.2f}:d=6,atrim=0:{total:.2f}"
        run(["ffmpeg","-v","error","-y",*inputs,"-i",MUSIC,"-filter_complex",fc,
             "-map",last,"-map",f"{a}:a","-af",af,"-t",f"{total:.2f}",
             "-c:v","libx264","-crf","20","-preset","medium","-pix_fmt","yuv420p",
             "-c:a","aac","-b:a","192k","-movflags","+faststart",OUT])
        print("Xong:", OUT, f"({total:.1f}s)")

if __name__ == "__main__":
    main()
