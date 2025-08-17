# E-Commerce System Setup Guide

## Environment Variables

Create a `.env` file in your project root with the following variables:

```bash
# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_change_in_production
JWT_EXPIRES_IN=7d

# Payment Gateway Configuration
PAYMENT_GATEWAY_API_KEY=your_payment_gateway_api_key
PAYMENT_GATEWAY_SECRET=your_payment_gateway_secret
PAYMENT_GATEWAY_WEBHOOK_SECRET=your_webhook_secret

# SMTP Configuration for Email Notifications
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Database Configuration
DATABASE_URL=./database.sqlite

# Server Configuration
PORT=4000
NODE_ENV=development
```

## Database Tables Created

The system automatically creates the following tables:

### 1. User Authentication
- `users_auth` - User accounts with authentication
- `user_addresses` - User delivery addresses

### 2. Order Management
- `orders_new` - Main orders table
- `order_items_new` - Individual items in orders
- `order_status_history` - Order status tracking

### 3. Payment System
- `payments` - Payment records and status

### 4. Inventory Management
- `product_inventory` - Product stock levels

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile
- `PUT /api/auth/profile` - Update user profile

### Address Management
- `POST /api/auth/addresses` - Add new address
- `GET /api/auth/addresses` - Get user addresses
- `PUT /api/auth/addresses/:id` - Update address
- `DELETE /api/auth/addresses/:id` - Delete address

### Order Management
- `POST /api/orders` - Create new order
- `GET /api/orders/user/:userId` - Get user orders
- `GET /api/orders/:orderId` - Get order details
- `PUT /api/orders/:orderId/status` - Update order status

### Payment Integration
- `POST /api/payments/initialize` - Initialize payment
- `POST /api/payments/webhook` - Payment webhook
- `GET /api/payments/:paymentId/status` - Get payment status

### Inventory Management
- `GET /api/inventory/check` - Check product availability
- `PUT /api/inventory/update` - Update inventory

### Email Notifications
- `POST /api/notifications/email/order-confirmation` - Order confirmation email
- `POST /api/notifications/email/shipping-update` - Shipping update email

## Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   - Copy the environment variables above to a `.env` file

3. **Initialize database:**
   ```bash
   node index.js --initdb
   ```

4. **Start the server:**
   ```bash
   node index.js
   ```

## Testing the System

### 1. User Registration
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "password": "password123",
    "phone": "+1234567890"
  }'
```

### 2. User Login
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@example.com",
    "password": "password123"
  }'
```

### 3. Create Order
```bash
curl -X POST http://localhost:4000/api/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "items": [
      {
        "productId": 1,
        "quantity": 2
      }
    ],
    "deliveryAddress": {
      "addressLine1": "123 Main St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001",
      "country": "USA"
    },
    "paymentMethod": "credit_card"
  }'
```

## Security Features

- JWT-based authentication
- Password hashing with bcrypt
- Rate limiting on checkout endpoints
- Input validation and sanitization
- CORS configuration
- User authorization checks

## Production Considerations

1. **Change default JWT secret**
2. **Use environment variables for all secrets**
3. **Implement proper webhook signature verification**
4. **Use Redis for rate limiting**
5. **Set up proper SMTP configuration**
6. **Implement payment gateway integration**
7. **Add comprehensive logging**
8. **Set up monitoring and alerting**

## Database Indexes

The system automatically creates performance indexes on:
- `orders_new.user_id`
- `orders_new.status`
- `orders_new.created_at`
- `order_items_new.order_id`
- `payments.order_id`
- `user_addresses.user_id`
