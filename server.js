const express = require('express');
const path = require('path');
const {
	SESClient,
	SendEmailCommand,
	SendRawEmailCommand,
} = require('@aws-sdk/client-ses');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const MailComposer = require('mailcomposer');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure local environment variable injection works
require('dotenv').config();

// Configure view processing parameters
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Core Structural Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// ==========================================================================
// ANTI-SPAM DEFINITION
// ==========================================================================
const contactLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 3,
	message:
		'Too many consultation requests sent from this IP network footprint. Please try again shortly.',
	standardHeaders: true,
	legacyHeaders: false,
});

// ==========================================================================
// AWS SES CLIENT SETUP
// ==========================================================================
const sesClient = new SESClient({
	region: process.env.AWS_REGION || 'us-east-2',
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	},
});

// ==========================================================================
// MULTER FILE UPLOAD SETUP
// ==========================================================================
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });
const uploadSingle = upload.single('blueprintUpload');

// ==========================================================================
// EXPRESS ROUTING ENGINE
// ==========================================================================

// 1. Home Page Route
app.get('/', (req, res) => {
	const seo = {
		title: 'Building Home | Luxury Home Construction & Renovations Tampa Bay',
		description:
			'Premium custom home construction, modern renovations, and structural enhancements serving Brandon, Tampa, Clearwater, St. Pete, and Wesley Chapel, FL.',
		keywords:
			'home construction Tampa, home renovations Brandon FL, kitchen remodeling Clearwater, custom home builder Wesley Chapel, contemporary home additions St Pete',
	};
	res.render('index', { seo });
});

// 2. About Page Route
app.get('/about', (req, res) => {
	const seo = {
		title: 'About Our Builders | Building Home | Tampa Bay Construction Group',
		description:
			'Meet the contemporary design and structural engineering team at Building Home. Constructing modern homes and additions across Brandon, St. Pete, and Clearwater.',
		keywords:
			'custom home builders Brandon FL, modern architecture Tampa, residential general contractors Clearwater, construction management St Petersburg',
	};
	res.render('about', { seo });
});

// 3. Services Page Route
app.get('/services', (req, res) => {
	const seo = {
		title: 'Our Services | Custom Home Building & Remodeling Tampa Bay',
		description:
			'Explore our premium construction capabilities. General contracting services across Brandon, Tampa, Clearwater, St. Pete, and Wesley Chapel, FL.',
		keywords:
			'custom home builds Florida, home extensions Tampa, luxury kitchen remodeling Clearwater, open concept conversion St Pete, structural contractors Wesley Chapel',
	};
	res.render('services', { seo });
});

// Testimonials Page Route
app.get('/testimonials', (req, res) => {
	const seo = {
		title: 'Licensed General Contractor Reviews | Building Home Florida',
		description:
			'Read verified testimonials from property owners regarding our custom ground-up new construction, commercial builds, and structural engineering across Florida.',
		keywords:
			'general contractor reviews Florida, new construction testimonials, custom home builder, commercial building contractor',
	};

	const reviews = [
		{
			name: 'Ivan & Mariam',
			location: 'Wesley Chapel | New Tampa',
			service: 'High-Impact Hurricane Window Integration & Structural Finishes',
			quote:
				'We hired Building Home to replace all the windows throughout our home with high-impact hurricane glass and advanced UV protection. The entire construction execution process was incredibly streamlined, and the communication from their team was consistently proactive.',
			date: 'June 2026',
		},
	];

	res.render('testimonials', { seo, reviews });
});

// 4. Contact Page Render Route
app.get('/contact', (req, res) => {
	const seo = {
		title: 'Contact Our Builders | Building Home | Schedule Consultation',
		description:
			'Connect with our custom building and remodeling team. Servicing Brandon, Tampa, Clearwater, St. Pete, and Wesley Chapel.',
		keywords: 'contractor consultation Tampa, quote home renovation Brandon',
	};
	res.render('contact', { seo, msg: null, err: null });
});

// ==========================================================================
// FORM SUBMISSION PROCESSOR (PROTECTED VIA TURNSTILE, HONEYPOTS & TIME-GATE)
// ==========================================================================
app.post('/contact', contactLimiter, uploadSingle, async (req, res) => {
	const defaultContactSeo = { title: 'Contact Our Builders | Building Home' };

	const {
		name,
		email,
		phone,
		service,
		budget,
		message,
		mid_initial_hp,
		website_url,
		form_load_time,
	} = req.body;

	const turnstileToken = req.body['cf-turnstile-response'];
	const uploadedFile = req.file;

	// ------------------------------------------------------------------------
	// SECURITY LAYER 1: MULTI-HONEYPOT DETECTION
	// ------------------------------------------------------------------------
	if (mid_initial_hp || website_url) {
		console.warn('Spam blocked via honeypot field.');
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: 'Submission Received! Your project parameters and files have been safely uploaded.',
			err: null,
		});
	}

	// ------------------------------------------------------------------------
	// SECURITY LAYER 2: TIME-GATING (Bot-speed Check)
	// ------------------------------------------------------------------------
	const loadTimestamp = parseInt(form_load_time, 10);
	const timeElapsed = Date.now() - loadTimestamp;

	if (!loadTimestamp || isNaN(loadTimestamp) || timeElapsed < 3000) {
		console.warn(`Spam blocked via time-gate (${timeElapsed}ms elapsed).`);
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: 'Submission Received! Your project parameters and files have been safely uploaded.',
			err: null,
		});
	}

	// ------------------------------------------------------------------------
	// SECURITY LAYER 3: CLOUDFLARE TURNSTILE TOKEN VERIFICATION
	// ------------------------------------------------------------------------
	if (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY) {
		if (!turnstileToken) {
			return res.render('contact', {
				seo: defaultContactSeo,
				msg: null,
				err: 'Security verification missing. Please complete the security challenge.',
			});
		}

		try {
			const verifyRes = await fetch(
				'https://challenges.cloudflare.com/turnstile/v0/siteverify',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						secret: process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
						response: turnstileToken,
						remoteip: req.ip || req.headers['x-forwarded-for'],
					}),
				},
			);

			const outcome = await verifyRes.json();
			if (!outcome.success) {
				console.warn('Turnstile verification failed:', outcome);
				return res.render('contact', {
					seo: defaultContactSeo,
					msg: null,
					err: 'Security challenge failed. Please try submitting again.',
				});
			}
		} catch (err) {
			console.error('Error verifying Cloudflare Turnstile:', err);
			return res.render('contact', {
				seo: defaultContactSeo,
				msg: null,
				err: 'Unable to verify security status. Please try again.',
			});
		}
	}

	// ------------------------------------------------------------------------
	// SERVER-SIDE FIELD VALIDATION LAYER
	// ------------------------------------------------------------------------
	if (!name || !email || !phone || !service || !budget || !message) {
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: null,
			err: 'Validation Breakdown: All required project fields must be filled out completely.',
		});
	}

	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!emailRegex.test(email)) {
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: null,
			err: 'Invalid formatting syntax detected on the email input field.',
		});
	}

	// ------------------------------------------------------------------------
	// TEXT SANITIZATION & CLEANUP
	// ------------------------------------------------------------------------
	const cleanName = name.replace(/[^\w\s.-]/g, '').trim();
	const cleanPhone = phone.replace(/[<>]/g, '').trim();
	const cleanMessage = message
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.trim();
	const logoUrl = 'https://cdn.buildinghomeco.com/logo.png';

	// Email Body Templates
	const clientHtmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Consultation Initialized</title></head>
    <body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: sans-serif; color: #1e293b;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding: 40px 20px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 30px;">
              <h1 style="color: #1a2e40;">Project Consultation Logged</h1>
              <p>Hello ${cleanName},</p>
              <p>Thank you for contacting Building Home. We have securely received your request.</p>
              <p><strong>Selected Focus:</strong> ${service}<br>
                 <strong>Investment Range:</strong> ${budget}<br>
                 <strong>Description:</strong> "${cleanMessage}"</p>
              <p>We will reach out to you at <strong>${cleanPhone}</strong> within 24–48 hours.</p>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

	const ownerHtmlBody = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>New Project Lead</title></head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: sans-serif; color: #0f172a;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="padding: 40px 20px;">
        <tr>
          <td align="center">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 650px; background-color: #ffffff; border-radius: 12px; border: 1px solid #cbd5e1; padding: 30px;">
              <h2 style="color: #1a2e40;">Project Parameters Dispatched</h2>
              <p><strong>Lead Name:</strong> ${cleanName}</p>
              <p><strong>Secure Email:</strong> ${email}</p>
              <p><strong>Phone:</strong> ${cleanPhone}</p>
              <p><strong>Scope Profile:</strong> ${service}</p>
              <p><strong>Target Budget:</strong> ${budget}</p>
              <p><strong>Plan Attached:</strong> ${uploadedFile ? uploadedFile.originalname : 'No file attached'}</p>
              <p><strong>Description:</strong><br>${cleanMessage}</p>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

	try {
		const ownerMailConfig = {
			from: process.env.NOTIFICATION_EMAIL,
			to: process.env.NOTIFICATION_RECEIVER,
			subject: `Project Scope Request from ${cleanName}`,
			html: ownerHtmlBody,
			replyTo: email,
			headers: {
				'X-Auto-Response-Suppress': 'All',
				Precedence: 'bulk',
			},
			attachments: uploadedFile
				? [
						{
							filename: uploadedFile.originalname,
							content: uploadedFile.buffer,
						},
					]
				: [],
		};

		const clientMailConfig = {
			from: process.env.NOTIFICATION_EMAIL,
			to: email,
			subject: `Consultation Received: ${service} Profile | Building Home`,
			html: clientHtmlBody,
		};

		const [rawOwnerEmail, rawClientEmail] = await Promise.all([
			new Promise((resolve, reject) => {
				new MailComposer(ownerMailConfig).build((err, message) => {
					if (err) return reject(err);
					resolve(message);
				});
			}),
			new Promise((resolve, reject) => {
				new MailComposer(clientMailConfig).build((err, message) => {
					if (err) return reject(err);
					resolve(message);
				});
			}),
		]);

		await Promise.all([
			sesClient.send(
				new SendRawEmailCommand({ RawMessage: { Data: rawOwnerEmail } }),
			),
			sesClient.send(
				new SendRawEmailCommand({ RawMessage: { Data: rawClientEmail } }),
			),
		]);

		return res.render('contact', {
			seo: defaultContactSeo,
			msg: 'Submission Received! Your project parameters and files have been safely uploaded.',
			err: null,
		});
	} catch (error) {
		console.error('Infrastructure Error during AWS SES Email dispatch:', error);
		return res.render('contact', {
			seo: defaultContactSeo,
			msg: null,
			err: 'An infrastructure communication error occurred during mail delivery. Please try again.',
		});
	}
});

// Terms of Service Page Route
app.get('/terms', (req, res) => {
	const seo = {
		title: 'Terms of Service | Licensed Contractor Statutory Disclosures',
		description:
			'Review the regulatory framework and statutory compliance clauses under FL CBC1267326.',
		keywords: 'building home terms, construction service conditions Florida',
	};
	res.render('terms', { seo });
});

// Catch-all fallback
app.get('*all', (req, res) => {
	res.redirect('/');
});

// Server Start
app.listen(PORT, '0.0.0.0', () => {
	console.log(`Server is running on http://localhost:${PORT}`);
});
