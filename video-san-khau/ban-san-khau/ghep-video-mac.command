#!/bin/sh
cd "$(dirname "$0")"
echo "Đang ghép video sân khấu, vui lòng đợi..."
cat video-san-khau.mp4.part0* > "Video-Le-Thanh-Hon-San-Khau-1080p.mp4"
echo "Xong! File: Video-Le-Thanh-Hon-San-Khau-1080p.mp4"
