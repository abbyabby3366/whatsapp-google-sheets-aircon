# WhatsApp Baileys Bot

A simple WhatsApp bot using `@whiskeysockets/baileys` with a web interface and external API support.

## Features
- QR code authentication via web UI
- Send messages and images through web interface
- External API endpoints for programmatic messaging
- Load contacts and groups
- Docker containerization for easy deployment
- Google Cloud Run ready

## Local Development

### Installation
```bash
npm install
```

### Running the Server
```bash
npm run dev
```

### UI
Open `http://localhost:8080` to authenticate and test sending messages.

## API Endpoints

### Health Check
- **URL**: `/api/health`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2024-01-01T12:00:00.000Z",
    "whatsappStatus": "ready"
  }
  ```

### Get Status
- **URL**: `/api/status`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "status": "ready",
    "qrCodeAvailable": false,
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
  ```

### Send Message (Web Interface)
- **URL**: `/api/send-message`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Body**:
  - `number`: Phone number (with country code)
  - `message`: Text message
  - `images`: Image files (optional)

### Send Message (External API)
- **URL**: `/api/external/send-message`
- **Method**: `POST`
- **Content-Type**: `application/json`
- **Body**:
  ```json
  {
    "number": "60123456789",
    "message": "Hello from external API!"
  }
  ```
  Note: `number` can also be a WhatsApp Group JID (e.g., `120363424584075789@g.us`).
- **Response**:
  ```json
  {
    "success": true,
    "message": "Message sent successfully",
    "messageId": "message-id",
    "recipient": "60123456789",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
  ```

### Get Groups
- **URL**: `/api/groups`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "success": true,
    "groups": [
      {
        "id": "group-id@g.us",
        "subject": "Group Name",
        "isCommunity": false,
        "isCommunityAnnouncement": false
      }
    ]
  }
  ```

### Get Contacts
- **URL**: `/api/contacts`
- **Method**: `GET`
- **Response**:
  ```json
  {
    "contacts": [
      {
        "id": "60123456789@s.whatsapp.net",
        "name": "John Doe",
        "number": "60123456789"
      }
    ]
  }
  ```

## Docker Deployment

### Build Docker Image
```bash
docker build -t whatsapp-bot .
```

### Run Locally with Docker
```bash
docker run -p 8080:8080 whatsapp-bot
```

## Google Cloud Run Deployment

### Prerequisites
- Google Cloud SDK installed and configured
- Enable Cloud Run API in your Google Cloud project
- Enable Container Registry API

### Deploy to Cloud Run
```bash
# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/whatsapp-bot

# Deploy to Cloud Run
gcloud run deploy whatsapp-bot \
  --image gcr.io/YOUR_PROJECT_ID/whatsapp-bot \
  --platform managed \
  --region YOUR_REGION \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1
```

### Environment Variables
Cloud Run will automatically set the `PORT` environment variable. The application defaults to port 8080.

### Usage
1. After deployment, visit the provided Cloud Run URL
2. Scan the QR code to authenticate your WhatsApp account
3. Use the web interface to send messages or call the external API endpoint

### External API Usage
```bash
curl -X POST https://your-cloud-run-url/api/external/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "number": "60123456789",
    "message": "Hello from external API!"
  }'
```

## Security Notes
- The external API endpoint allows anyone to send messages through your WhatsApp account
- Consider implementing authentication/authorization for production use
- Store authentication data securely (the `baileys_auth_info` directory contains sensitive session data)