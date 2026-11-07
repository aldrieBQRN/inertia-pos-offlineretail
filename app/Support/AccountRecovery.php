<?php

namespace App\Support;

use App\Models\RecoveryQuestion;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * Offline account recovery with three security questions.
 *
 * Answers are normalized (trimmed, inner whitespace collapsed, lower-cased) and then
 * hashed like the Admin credential. Plain answers are never stored or returned.
 */
class AccountRecovery
{
    public const QUESTION_COUNT = 3;

    /** Value the setup form sends when the Admin writes their own question. */
    public const CUSTOM = 'custom';

    /** Predefined questions (none ask for IDs, banking details or passwords). */
    public const QUESTIONS = [
        'What was the name of your first pet?',
        'What was the name of your first school?',
        'What city were you born in?',
        'What was your childhood nickname?',
        'What was the name of your first teacher?',
        'What is the name of the street you grew up on?',
        'What was the first product your store ever sold?',
        'What is your favorite food?',
    ];

    /**
     * Rules for the `recovery` input: three entries of {question, custom_question, answer}.
     */
    public static function rules(): array
    {
        return [
            'recovery' => ['required', 'array', 'size:' . self::QUESTION_COUNT],
            'recovery.*.question' => ['required', 'string', Rule::in([...self::QUESTIONS, self::CUSTOM])],
            'recovery.*.custom_question' => ['nullable', 'required_if:recovery.*.question,' . self::CUSTOM, 'string', 'min:10', 'max:150'],
            'recovery.*.answer' => ['required', 'string', 'max:100', function (string $attribute, $value, \Closure $fail) {
                if (mb_strlen(self::normalize((string) $value)) < 2) {
                    $fail('Each answer must be at least 2 characters.');
                }
            }],
        ];
    }

    public static function attributes(): array
    {
        $attributes = [];
        foreach (range(0, self::QUESTION_COUNT - 1) as $i) {
            $n = $i + 1;
            $attributes["recovery.$i.question"] = "question $n";
            $attributes["recovery.$i.custom_question"] = "custom question $n";
            $attributes["recovery.$i.answer"] = "answer $n";
        }

        return $attributes;
    }

    /**
     * Adds the "three different questions" check to a validator.
     */
    public static function rejectDuplicateQuestions(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $seen = [];
            foreach ((array) ($validator->getData()['recovery'] ?? []) as $i => $entry) {
                $text = self::normalize(self::questionText((array) $entry));
                if ($text === '') {
                    continue;
                }
                if (in_array($text, $seen, true)) {
                    $validator->errors()->add("recovery.$i.question", 'Choose three different questions.');
                }
                $seen[] = $text;
            }
        });
    }

    /**
     * The question text an entry resolves to (predefined or the Admin's own).
     */
    public static function questionText(array $entry): string
    {
        return ($entry['question'] ?? '') === self::CUSTOM
            ? trim((string) ($entry['custom_question'] ?? ''))
            : trim((string) ($entry['question'] ?? ''));
    }

    /**
     * Normalizes an answer so " Manila " and "manila" verify the same.
     */
    public static function normalize(string $value): string
    {
        return mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $value)));
    }

    /**
     * Replaces the Admin's recovery questions with the validated entries.
     */
    public static function store(User $user, array $entries): void
    {
        $user->recoveryQuestions()->delete();

        foreach (array_values($entries) as $i => $entry) {
            RecoveryQuestion::create([
                'user_id' => $user->id,
                'position' => $i + 1,
                'question' => self::questionText($entry),
                'answer_hash' => Hash::make(self::normalize((string) $entry['answer'])),
            ]);
        }
    }

    public static function isConfigured(?User $user): bool
    {
        return $user !== null
            && $user->recoveryQuestions()->count() === self::QUESTION_COUNT;
    }

    /**
     * True only when every answer matches. All answers are always checked so the
     * response time does not reveal which one was wrong.
     *
     * @param array<int, string> $answers answers in question order
     */
    public static function verify(User $user, array $answers): bool
    {
        $questions = $user->recoveryQuestions()->get();
        if ($questions->count() !== self::QUESTION_COUNT) {
            return false;
        }

        $allMatch = true;
        foreach ($questions->values() as $i => $question) {
            $given = self::normalize((string) ($answers[$i] ?? ''));
            $matches = Hash::check($given, $question->answer_hash);
            $allMatch = $allMatch && $matches;
        }

        return $allMatch;
    }
}
