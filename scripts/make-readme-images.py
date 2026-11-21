"""Generate the three README illustrations (mockups, not screenshots).

The images are drawn from scratch so the README can show the UI without any
machine paths, session titles or personal data. Run:

    python scripts/make-readme-images.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"

FONT_CN = "C:/Windows/Fonts/msyh.ttc"
FONT_CN_BD = "C:/Windows/Fonts/msyhbd.ttc"

BG = (23, 24, 28)
CARD = (32, 34, 39)
BORDER = (66, 68, 75)
TEXT = (232, 233, 236)
MUTED = (150, 152, 158)
GREEN = (72, 187, 120)
AMBER = (214, 158, 46)


def font(size, bold=False):
    return ImageFont.truetype(FONT_CN_BD if bold else FONT_CN, size)


def round_box(draw, box, radius, fill=CARD, outline=BORDER, width=2):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def label(draw, xy, text, size=20, color=TEXT, bold=False):
    draw.text(xy, text, font=font(size, bold), fill=color)


def draw_check(draw, x, y, color=GREEN):
    draw.line((x, y + 7, x + 5, y + 12), fill=color, width=3)
    draw.line((x + 5, y + 12, x + 14, y), fill=color, width=3)


def draw_dot(draw, x, y, color=MUTED):
    draw.ellipse((x + 3, y + 6, x + 10, y + 13), fill=color)


def draw_triangle(draw, x, y, down, color=MUTED):
    if down:
        draw.polygon([(x, y), (x + 11, y), (x + 5, y + 7)], fill=color)
    else:
        draw.polygon([(x, y), (x + 7, y + 5), (x, y + 10)], fill=color)


def mockup(width, height):
    image = Image.new("RGB", (width, height), BG)
    draw = ImageDraw.Draw(image)
    label(draw, (28, 20), "示意图 / mockup", 16, MUTED)
    return image, draw


def draw_row(draw, x, y, kind, item_id, text, sub, highlight=False):
    if highlight:
        draw.rounded_rectangle((x - 14, y - 6, x + 1000, y + 44), 6, fill=(30, 46, 38))
        draw.rectangle((x - 14, y - 6, x - 11, y + 44), fill=GREEN)
    if kind == "check":
        draw_check(draw, x, y)
    elif kind == "dot":
        draw_dot(draw, x, y)
    else:
        label(draw, (x, y - 3), "?", 20, AMBER, True)
    label(draw, (x + 28, y - 2), item_id, 18, MUTED)
    label(draw, (x + 78, y - 2), text, 18, TEXT)
    label(draw, (x + 78, y + 21), sub, 15, MUTED)


def dock_collapsed():
    image, draw = mockup(1200, 230)
    round_box(draw, (30, 56, 1170, 116), 12)
    draw_triangle(draw, 52, 78, down=False)
    label(draw, (78, 72), "任务单", 22, TEXT, True)
    label(draw, (156, 74), "3/7", 21, TEXT)
    label(draw, (218, 75), "run 模式", 18, MUTED)
    label(draw, (316, 74), "接管中 · 清单没清空不许结束回合", 19, GREEN)
    round_box(draw, (30, 132, 1170, 206), 14)
    label(draw, (56, 158), "给桥加桥墩上限，然后跑一次单测…", 19, MUTED)
    round_box(draw, (980, 148, 1150, 190), 21, fill=(38, 52, 44), outline=(62, 120, 88))
    label(draw, (998, 158), "任务单 · 开", 17, GREEN, True)
    label(draw, (880, 158), "发送", 17, MUTED)
    image.save(OUT / "plan-dock-collapsed.png")


def dock_open():
    image, draw = mockup(1200, 470)
    round_box(draw, (30, 56, 1170, 440), 12)
    draw_triangle(draw, 52, 78, down=True)
    label(draw, (78, 72), "任务单", 22, TEXT, True)
    label(draw, (156, 74), "3/7", 21, TEXT)
    label(draw, (218, 75), "run 模式", 18, MUTED)
    label(draw, (316, 74), "接管中 · 清单没清空不许结束回合", 19, GREEN)
    draw.rounded_rectangle((52, 108, 1148, 114), 3, fill=(52, 54, 60))
    draw.rounded_rectangle((52, 108, 520, 114), 3, fill=GREEN)

    rows = [
        ("check", "P1", "读现有 pre-execute 与 PlanManager，确定门禁插入点", "证据：log:…@GATE-DESIGN", False),
        ("check", "P2", "新增 workgate 模块（无开放项拒绝）", "证据：sha256:lib/workgate.js@1f3a…", False),
        ("check", "P3", "接入工作门禁并支持 requireOpenItemForWork", "证据：log:…@INDEX-WIRED", False),
        ("dot", "P4", "补单测：无单 / 暂停 / 全完成 / 有开放项", "验收：测试日志 fail 0 且覆盖 paused", True),
        ("question", "P5", "确认是否需要保留旧单历史", "待你：历史要保留多久？", False),
    ]
    y = 132
    for kind, item_id, text, sub, next_item in rows:
        draw_row(draw, 58, y, kind, item_id, text, sub, next_item)
        y += 56
    image.save(OUT / "plan-dock-open.png")


def viewer():
    image, draw = mockup(960, 600)
    draw.rectangle((0, 0, 960, 600), fill=(17, 18, 21))
    label(draw, (28, 20), "示意图 / mockup", 16, MUTED)
    round_box(draw, (110, 40, 850, 560), 16, fill=(28, 30, 35))
    label(draw, (140, 68), "本对话任务单", 24, TEXT, True)
    label(draw, (700, 72), "3/7", 18, MUTED)
    label(draw, (808, 66), "×", 24, MUTED)
    rows = [
        ("check", "P1", "读现有 pre-execute 与 PlanManager", "验收：verify 日志出现 GATE-DESIGN"),
        ("check", "P2", "新增 workgate 模块", "验收：workgate.js 含 workGateDecision"),
        ("check", "P3", "接入工作门禁", "验收：index.js 出现 requireOpenItemForWork"),
        ("dot", "P4", "补单测", "验收：fail 0 且覆盖 paused"),
        ("question", "P5", "确认历史保留策略", "待你：保留多久？"),
    ]
    y = 112
    for kind, item_id, text, sub in rows:
        draw_row(draw, 142, y, kind, item_id, text, sub)
        y += 54
    draw.line((140, 400, 820, 400), fill=(55, 57, 63), width=1)
    label(draw, (140, 416), "历史单（2）", 17, TEXT, True)
    label(draw, (140, 444), "已完成 · 2026-11-21 16:48 · 7 项", 15, MUTED)
    label(draw, (140, 470), "已完成 · 2026-11-21 16:41 · 7 项", 15, MUTED)
    label(draw, (140, 520), "host dsh-plan 0.5.4", 13, MUTED)
    image.save(OUT / "plan-viewer.png")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dock_collapsed()
    dock_open()
    viewer()
    for name in ("plan-dock-collapsed.png", "plan-dock-open.png", "plan-viewer.png"):
        path = OUT / name
        print(f"{name}: {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
