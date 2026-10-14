"""Outgoing e-mail over SMTP with STARTTLS (CI-5). If SMTP_HOST is not set the message is printed to the
container log, so verification and reset links can be taken from `docker logs` during development."""
from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage


def send_mail(settings, outbox: list | None, to: str, subject: str, body: str) -> None:
    if outbox is not None:  # tests
        outbox.append({"to": to, "subject": subject, "body": body})
    if not settings.smtp_host:
        print(f"[mail] SMTP_HOST not set, not sent. To: {to} | Subject: {subject}\n{body}", flush=True)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as exc:
        print(f"[mail] sending to {to} failed: {exc}", flush=True)
