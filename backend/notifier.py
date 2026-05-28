import os
import requests
import logging

logger = logging.getLogger(__name__)

class NotificationService:
    def __init__(self):
        # 텔레그램 봇 토큰과 채팅 ID (환경 변수 또는 하드코딩)
        # 봇 생성 방법: 텔레그램에서 @BotFather 검색 -> /newbot -> 토큰 발급
        # Chat ID 얻는 방법: 봇에게 말 걸고 https://api.telegram.org/bot<토큰>/getUpdates 확인
        self.telegram_token = os.environ.get("TELEGRAM_BOT_TOKEN", "YOUR_TELEGRAM_BOT_TOKEN_HERE")
        self.chat_id = os.environ.get("TELEGRAM_CHAT_ID", "YOUR_CHAT_ID_HERE")
        
    def send_telegram_message(self, message: str) -> bool:
        if self.telegram_token == "YOUR_TELEGRAM_BOT_TOKEN_HERE":
            logger.warning("Telegram Bot Token is not set. Mocking notification:")
            logger.info(f"🔔 [MOCK ALERT] {message}")
            return True
            
        url = f"https://api.telegram.org/bot{self.telegram_token}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": message,
            "parse_mode": "HTML"
        }
        
        try:
            response = requests.post(url, json=payload, timeout=5)
            if response.status_code == 200:
                logger.info("Successfully sent telegram alert.")
                return True
            else:
                logger.error(f"Failed to send telegram alert: {response.text}")
                return False
        except Exception as e:
            logger.error(f"Error sending telegram alert: {e}")
            return False

# 싱글톤 인스턴스
notifier = NotificationService()
