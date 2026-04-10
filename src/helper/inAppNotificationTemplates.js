class InAppNotificationTemplates {
    static notificationTemplates = {
        // Lesson Management
        lesson_booked: {
            EN: {
                title: 'Lesson Booked Successfully',
                content: "Your lesson with {{instructor.name}} is scheduled for {{time.date}}. Don't forget to join on time!"
            },
            HE: {
                title: 'השיעור הוזמן בהצלחה',
                content: 'השיעור עם {{instructor.name}} נקבע ל-{{time.date}}. אל תשכח להצטרף בזמן!'
            }
        },
        booking_done: {
            EN: {
                title: 'Booking Confirmed',
                content: "Your booking for {{class.type}} with {{instructor.name}} on {{time.date}} is confirmed!"
            },
            HE: {
                title: 'הזמנה מאושרת',
                content: 'ההזמנה שלך ל{{class.type}} עם {{instructor.name}} ב-{{time.date}} אושרה!'
            }
        },
        

        lesson_started: {
            EN: {
                title: 'Lesson Started',
                content: "Your lesson has started! Click to join now."
            },
            HE: {
                title: 'השיעור התחיל',
                content: 'השיעור שלך התחיל! לחץ להצטרפות עכשיו.'
            }
        },

        student_class_cancelled: {
            EN: {
                title: 'Lesson Canceled',
                content: "Student {{student.name}} canceled the class on {{class.time}}."
            },
            HE: {
                title: 'שיעור בוטל',
                content: 'התלמיד {{student.name}} ביטל את השיעור ב-{{class.time}}.'
            }
        },

        student_class_rescheduled: {
            EN: {
                title: 'Lesson Rescheduled',
                content: "Student {{student.name}} moved class from {{old.time}} to {{new.time}}."
            },
            HE: {
                title: 'שיעור נדחה',
                content: 'התלמיד {{student.name}} העביר שיעור מ-{{old.time}} ל-{{new.time}}.'
            }
        },

        regular_class_cancelled: {
            EN: {
                title: 'Regular Class Canceled',
                content: "Student {{student.name}} canceled their regular class on {{class.date}} at {{class.time}}."
            },
            HE: {
                title: 'שיעור קבוע בוטל',
                content: 'התלמיד {{student.name}} ביטל את השיעור הקבוע ב-{{class.date}} בשעה {{class.time}}.'
            }
        },

        // Games
        practice_games_ready: {
            EN: {
                title: '{{gamesCount}} new practice games ready',
                content: 'Based on your lesson: {{topics}}'
            },
            HE: {
                title: '{{gamesCount}} משחקי תרגול חדשים מוכנים',
                content: 'בהתבסס על השיעור שלך: {{topics}}'
            }
        },

        // Class Reminders
        regular_class_reminders_24: {
            EN: {
                title: 'Class Tomorrow',
                content: "Your English lesson is tomorrow at {{time.time}}."
            },
            HE: {
                title: 'כיתה מחר',
                content: 'שיעור האנגלית שלך מחר בשעה {{time.time}}.'
            }
        },

        regular_class_reminders_4: {
            EN: {
                title: 'Class in 4 Hours',
                content: "Your lesson starts in 4 hours at {{time.time}}."
            },
            HE: {
                title: 'כיתה בעוד 4 שעות',
                content: 'השיעור שלך מתחיל בעוד 4 שעות בשעה {{time.time}}.'
            }
        },

        regular_class_reminders_1: {
            EN: {
                title: 'Class in 1 Hour',
                content: "Your lesson starts in 1 hour. Get ready!"
            },
            HE: {
                title: 'כיתה בעוד שעה',
                content: 'השיעור שלך מתחיל בעוד שעה. התכונן!'
            }
        },

        regular_class_reminders_30: {
            EN: {
                title: 'Class in 30 Minutes',
                content: "Your lesson starts in 30 minutes. Please join on time!"
            },
            HE: {
                title: 'כיתה בעוד 30 דקות',
                content: 'השיעור מתחיל בעוד 30 דקות. אנא הצטרף בזמן!'
            }
        },

        inactivity_login_reminder: {
            EN: {
                title: 'We miss you on Tulkka',
                content: 'Hi {{user.name}}, log in to see what’s waiting for you.'
            },
            HE: {
                title: 'מתגעגעים אליך בטולקה',
                content: 'היי {{user.name}}, התחבר כדי לראות מה מחכה לך.'
            }
        },

        remaining_lessons_booking_reminder: {
            EN: {
                title: 'You have {{subscription.remaining}} lessons left',
                content: 'Hi {{user.name}}, you still have {{subscription.remaining}} lessons remaining in your subscription. Book your next lesson now.'
            },
            HE: {
                title: 'נשארו לך {{subscription.remaining}} שיעורים',
                content: 'היי {{user.name}}, נשארו לך {{subscription.remaining}} שיעורים במנוי. הזמינ/י שיעור עכשיו.'
            }
        },

        // Learning Content
        homework_received: {
            EN: {
                title: 'New Homework',
                content: "New homework from {{instructor.name}} is waiting for you."
            },
            HE: {
                title: 'שיעורי בית חדשים',
                content: 'שיעורי בית חדשים מ{{instructor.name}} מחכים לך.'
            }
        },

        quiz_received: {
            EN: {
                title: 'New Quiz',
                content: "You received a new quiz from {{instructor.name}}. Complete it on time."
            },
            HE: {
                title: 'מבחן חדש',
                content: 'קיבלת מבחן חדש מ{{instructor.name}}. השלם בזמן.'
            }
        },

        feedback_received: {
            EN: {
                title: 'New Feedback',
                content: "{{instructor.name}} provided feedback on your lesson."
            },
            HE: {
                title: 'משוב חדש',
                content: '{{instructor.name}} סיפק משוב על השיעור שלך.'
            }
        },

        homework_completed: {
            EN: {
                title: 'Homework Completed',
                content: "{{student.name}} completed their homework."
            },
            HE: {
                title: 'שיעורי בית הושלמו',
                content: '{{student.name}} השליפ את שיעורי הבית.'
            }
        },

        quiz_completed: {
            EN: {
                title: 'Quiz Completed',
                content: "{{student.name}} completed their quiz."
            },
            HE: {
                title: 'מבחן הושלם',
                content: '{{student.name}} השליפ את המבחן.'
            }
        },

        // // Regular Classes
        // regular_class_booked_for_teacher_new: {
        //     EN: {
        //         title: 'Regular Classes Scheduled',
        //         content: "You're now teaching {{student.name}} every {{time.day}} at {{time.date}}."
        //     },
        //     HE: {
        //         title: 'שיעורים קבועים נקבעו',
        //         content: 'אתה מלמד את {{student.name}} כל {{time.day}} בשעה {{time.date}}.'
        //     }
        // },

        regular_class_booked_for_student_new: {
            EN: {
                title: 'Regular Classes Scheduled',
                content: "Your lessons with {{instructor.name}} are every {{time.day}} at {{time.date}}."
            },
            HE: {
                title: 'שיעורים קבועים נקבעו',
                content: 'השיעורים שלך עם {{instructor.name}} כל {{time.day}} בשעה {{time.date}}.'
            }
        },

        // Monthly Renewals
        renew_regular_class_booked_good: {
            EN: {
                title: 'Monthly Classes Booked',
                content: "Your classes for this month have been scheduled successfully."
            },
            HE: {
                title: 'השיעורים החודשיים נקבעו',
                content: 'השיעורים שלך לחודש זה נקבעו בהצלחה.'
            }
        },

        renew_class_teacher_notavilableform_students: {
            EN: {
                title: 'Some Classes Unavailable',
                content: "Some classes couldn't be booked due to teacher unavailability. Check app for alternatives."
            },
            HE: {
                title: 'חלק מהשיעורים לא זמינים',
                content: 'חלק מהשיעורים לא נקבעו עקב אי זמינות המורה. בדוק באפליקציה חלופות.'
            }
        },

        renew_class_overclasses_form_students: {
            EN: {
                title: 'Monthly Quota Reached',
                content: "Some classes couldn't be booked - you've reached your monthly limit."
            },
            HE: {
                title: 'הגעת לגבול החודשי',
                content: 'חלק מהשיעורים לא נקבעו - הגעת למכסה החודשית.'
            }
        },

        regular_class_book_for_teacher: {
            EN: {
                title: 'New Class Booked',
                content: "{{student.name}} booked a class with you on {{time.date}} at {{time.time}}."
            },
            HE: {
                title: 'שיעור חדש הוזמן',
                content: '{{student.name}} הזמין שיעור איתך ב-{{time.date}} בשעה {{time.time}}.'
            }
        },

        // Payment Notifications
        payment_successful: {
            EN: {
                title: 'Payment Successful',
                content: "Your payment for {{package.name}} was processed successfully!"
            },
            HE: {
                title: 'התשלום בוצע בהצלחה',
                content: 'התשלום שלך עבור {{package.name}} בוצע בהצלחה!'
            }
        },

        payment_failed: {
            EN: {
                title: 'Payment Failed',
                content: "There was an issue with your payment. Please try again."
            },
            HE: {
                title: 'התשלום נכשל',
                content: 'הייתה בעיה עם התשלום שלך. אנא נסה שוב.'
            }
        },

        payment_reminder: {
            EN: {
                title: 'Payment Reminder',
                content: "Complete your enrollment for {{package.name}} - expires in {{expiry.days}} days."
            },
            HE: {
                title: 'תזכורת תשלום',
                 content: 'השלם את ההרשמה ל{{package.name}} - פג תוקף בעוד {{expiry.days}} ימים.'
            }
        },

        subscription_canceled_unpaid: {
            EN: {
                title: 'Subscription Canceled',
                content:
                    "Hello {{student.name}},\n\n" +
                    "We're sorry to inform you that your {{subscription.type}} has been canceled due to unpaid balance.\n\n" +
                    "Failed payment date: {{failed.date}}\n" +
                    "Cancellation date: {{canceled.date}}\n\n" +
                    "{{reactivation.info}}\n\n" +
                    "For assistance contact us at {{support.email}}."
            },
            HE: {
                title: 'המנוי בוטל',
                content:
                    "שלום {{student.name}},\n\n" +
                    "מצטערים לעדכן כי ה{{subscription.type}} שלך בוטל עקב יתרה שלא שולמה.\n\n" +
                    "תאריך כשל החיוב: {{failed.date}}\n" +
                    "תאריך ביטול: {{canceled.date}}\n\n" +
                    "{{reactivation.info}}\n\n" +
                    "לסיוע אפשר לפנות אלינו בכתובת {{support.email}}."
            }
        },
        // Client UI notification messages (EN provided; HE fallback uses EN)
        class_booked_success: {
            EN: {
                title: 'Class Booked Successfully!',
                content: 'Your lesson with {{teacherName}} on {{dateTime}} has been confirmed.'
            },
            HE: {
                title: 'השיעור הוזמן בהצלחה!',
                content: 'השיעור שלך עם {{teacherName}} ב-{{dateTime}} אושר.'
            }
        },
        class_booking_failed: {
            EN: {
                title: 'Class Booking Failed',
                content: 'Unable to book your class. Please try again.'
            },
            HE: {
                title: 'הזמנת השיעור נכשלה',
                content: 'לא ניתן להזמין את השיעור. נסה/י שוב.'
            }
        },
        class_cancelled_success: {
            EN: {
                title: 'Class Cancelled Successfully',
                content: 'Your lesson with {{teacherName}} has been cancelled.'
            },
            HE: {
                title: 'השיעור בוטל בהצלחה',
                content: 'השיעור שלך עם {{teacherName}} בוטל.'
            }
        },
        class_cancelled_success_no_teacher: {
            EN: {
                title: 'Class Cancelled Successfully',
                content: 'Your lesson has been cancelled successfully.'
            },
            HE: {
                title: 'השיעור בוטל בהצלחה',
                content: 'השיעור שלך בוטל בהצלחה.'
            }
        },
        class_cancellation_failed: {
            EN: {
                title: 'Class Cancellation Failed',
                content: 'Unable to cancel your class. Please try again.'
            },
            HE: {
                title: 'ביטול השיעור נכשל',
                content: 'לא ניתן לבטל את השיעור. נסה/י שוב.'
            }
        },
        class_rescheduled_success: {
            EN: {
                title: 'Class Rescheduled Successfully!',
                content: 'Your lesson with {{teacherName}} has been moved to {{newDateTime}}.'
            },
            HE: {
                title: 'השיעור נדחה בהצלחה!',
                content: 'השיעור שלך עם {{teacherName}} הועבר ל-{{newDateTime}}.'
            }
        },
        class_rescheduling_failed: {
            EN: {
                title: 'Class Rescheduling Failed',
                content: 'Unable to reschedule your class. Please try again.'
            },
            HE: {
                title: 'דחיית השיעור נכשלה',
                content: 'לא ניתן לדחות את השיעור. נסה/י שוב.'
            }
        },
        homework_submitted_success: {
            EN: {
                title: 'Homework Submitted Successfully!',
                content: 'Your homework "{{homeworkTitle}}" has been submitted.'
            },
            HE: {
                title: 'שיעורי הבית נשלחו בהצלחה!',
                content: 'שיעורי הבית "{{homeworkTitle}}" נשלחו.'
            }
        },
        homework_submitted_success_no_title: {
            EN: {
                title: 'Homework Submitted Successfully!',
                content: 'Your homework has been submitted successfully.'
            },
            HE: {
                title: 'שיעורי הבית נשלחו בהצלחה!',
                content: 'שיעורי הבית נשלחו בהצלחה.'
            }
        },
        homework_submission_failed: {
            EN: {
                title: 'Homework Submission Failed',
                content: 'Unable to submit your homework. Please try again.'
            },
            HE: {
                title: 'שליחת שיעורי הבית נכשלה',
                content: 'לא ניתן לשלוח את שיעורי הבית. נסה/י שוב.'
            }
        },
        homework_deleted_success: {
            EN: {
                title: 'Homework Deleted Successfully',
                content: '"{{homeworkTitle}}" has been deleted.'
            },
            HE: {
                title: 'שיעורי הבית נמחקו בהצלחה',
                content: '"{{homeworkTitle}}" נמחקו.'
            }
        },
        homework_deleted_success_no_title: {
            EN: {
                title: 'Homework Deleted Successfully',
                content: 'Homework has been deleted successfully.'
            },
            HE: {
                title: 'שיעורי הבית נמחקו בהצלחה',
                content: 'שיעורי הבית נמחקו בהצלחה.'
            }
        },
        homework_deletion_failed: {
            EN: {
                title: 'Homework Deletion Failed',
                content: 'Unable to delete homework. Please try again.'
            },
            HE: {
                title: 'מחיקת שיעורי הבית נכשלה',
                content: 'לא ניתן למחוק את שיעורי הבית. נסה/י שוב.'
            }
        },
        settings_updated_success: {
            EN: {
                title: 'Settings Updated Successfully!',
                content: 'Your profile settings have been saved.'
            },
            HE: {
                title: 'ההגדרות עודכנו בהצלחה!',
                content: 'הגדרות הפרופיל שלך נשמרו.'
            }
        },
        Notification_settings_updated_success: {
            EN: {
                title: 'Notification Settings Updated Successfully!',
                content: 'Your notification preferences have been updated successfully. Channels: {{notification.channels}}. Reminder times: {{notification.times}}.'
            },
            HE: {
                title: 'הגדרות ההתראות עודכנו בהצלחה!',
                content: 'העדפות ההתראות שלך עודכנו בהצלחה. ערוצים: {{notification.channels}}. זמני תזכורת: {{notification.times}}.'
            }
        },
        settings_update_failed: {
            EN: {
                title: 'Settings Update Failed',
                content: 'Unable to update your settings. Please try again.'
            },
            HE: {
                title: 'עדכון ההגדרות נכשל',
                content: 'לא ניתן לעדכן את ההגדרות. נסה/י שוב.'
            }
        },
        file_uploaded_success: {
            EN: {
                title: 'File Uploaded Successfully!',
                content: '"{{fileName}}" has been uploaded.'
            },
            HE: {
                title: 'הקובץ הועלה בהצלחה!',
                content: '"{{fileName}}" הועלה.'
            }
        },
        file_uploaded_success_no_name: {
            EN: {
                title: 'File Uploaded Successfully!',
                content: 'Your file has been uploaded successfully.'
            },
            HE: {
                title: 'הקובץ הועלה בהצלחה!',
                content: 'הקובץ הועלה בהצלחה.'
            }
        },
        file_upload_failed: {
            EN: {
                title: 'File Upload Failed',
                content: 'Unable to upload file. Please try again.'
            },
            HE: {
                title: 'העלאת הקובץ נכשלה',
                content: 'לא ניתן להעלות את הקובץ. נסה/י שוב.'
            }
        },
    };

    static toData(template, values, useCase) {
        const title = template.title.replace(/{{(.*?)}}/g, (match, p1) => values[p1] || '');
        const content = template.content.replace(/{{(.*?)}}/g, (match, p1) => values[p1] || '');

        return {
            title: title,
            content: content
        };
    }

    static getNotification(key, language, useCase = 'push', values = {}) {
        language = language || 'HE';
        
        if (!InAppNotificationTemplates.notificationTemplates[key] || 
            !InAppNotificationTemplates.notificationTemplates[key][language]) {
            return null;
        }
        
        const notificationTemplate = InAppNotificationTemplates.notificationTemplates[key][language];
        const notification = InAppNotificationTemplates.toData(notificationTemplate, values, useCase);
        
        return notification;
    }
}

module.exports = InAppNotificationTemplates;
